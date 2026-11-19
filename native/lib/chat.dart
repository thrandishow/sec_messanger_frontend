import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import 'api.dart';

class Thread {
  final String target;
  String title;
  final Map<int, Json> _messages = {};
  final Set<String> members = {};
  String draft = '';
  int unread = 0;
  bool joined = false;
  bool loading = false;
  int? before;
  Thread(this.target, this.title);
  bool get group => target.startsWith('#');
  List<Json> get messages =>
      _messages.values.toList()
        ..sort((a, b) => (a['id'] as int).compareTo(b['id'] as int));
  Json? latest;
  bool merge(Json m) {
    final id = m['id'] as int;
    if (_messages.containsKey(id)) return false;
    _messages[id] = m;
    if (latest == null || id > (latest!['id'] as int)) latest = m;
    return true;
  }
}

class Chat extends ChangeNotifier {
  final ChatApi api;
  Json user;
  final void Function() expired;
  final Map<String, Thread> threads = {};
  List<String> people = [];
  String? active;
  String status = 'Подключение…';
  String? notice;
  bool connected = false;
  bool _closed = false;
  bool uploading = false;
  int _generation = 0, _attempts = 0;
  WebSocket? _socket;
  Timer? _retry, _deadline;
  (String, String, String?)? _pending;
  final Set<String> _joining = {};
  final Set<String> _mutedGroups = {};
  Chat(this.api, this.user, this.expired);
  String get nickname => user['nickname'] as String;
  bool get busy => _pending != null || uploading;
  bool get admin => user['role'] == 'admin';
  bool get moderator => user['role'] != 'member';
  bool canSend(Thread t) =>
      connected &&
      !busy &&
      (!t.group || t.joined) &&
      (t.target != '#announcements' || moderator);
  bool _valid(int gen) => !_closed && _generation == gen;
  void changed() {
    if (!_closed) notifyListeners();
  }

  void complain(Object e) {
    notice = errorMessage(e);
    changed();
  }

  void consumeNotice() {
    notice = null;
  }

  Future<void> start() async {
    if (_closed) return;
    final gen = ++_generation;
    _retry?.cancel();
    _reset();
    unawaited(_socket?.close());
    _socket = null;
    status = 'Подключение…';
    changed();
    try {
      final ws = await api.connect();
      if (!_valid(gen)) {
        await ws.close();
        return;
      }
      _socket = ws;
      ws.listen(
        (frame) {
          if (!_valid(gen)) return;
          try {
            _event(jsonDecode(frame as String) as Json, gen);
          } catch (_) {
            unawaited(ws.close());
          }
        },
        onError: (Object _) {},
        onDone: () {
          if (_valid(gen)) unawaited(_disconnected(gen));
        },
      );
    } catch (_) {
      if (_valid(gen)) await _disconnected(gen);
    }
  }

  void _reset() {
    connected = false;
    _deadline?.cancel();
    _pending = null;
    _joining.clear();
    for (final t in threads.values) {
      t.joined = false;
      t.members.clear();
    }
  }

  Future<void> _disconnected(int gen) async {
    _reset();
    status = 'Нет связи';
    changed();
    try {
      await api.get('/api/auth/me');
      final presence = await api.get('/api/chat/status');
      if (!_valid(gen)) return;
      if (presence['connected'] == true) {
        status = 'Аккаунт открыт на другом устройстве';
        changed();
        return;
      }
    } on ClientError catch (e) {
      if (e.status == 401 && _valid(gen)) {
        expired();
        return;
      }
    } catch (_) {}
    if (!_valid(gen)) return;
    _attempts = (_attempts + 1).clamp(1, 5);
    _retry = Timer(Duration(seconds: 1 << (_attempts - 1)), start);
  }

  Future<void> refreshDirectory() async {
    final gen = _generation;
    final d = await api.get('/api/directory');
    if (!_valid(gen)) return;
    final channels = (d['channels'] as List).cast<Json>();
    final allowed = {for (final row in channels) row['channel'] as String};
    threads.removeWhere(
      (key, _) => key.startsWith('#') && !allowed.contains(key),
    );
    if (active != null && !threads.containsKey(active)) active = null;
    for (final c in channels) {
      final key = c['channel'] as String;
      if (!_mutedGroups.contains(key)) {
        (threads[key] ??= Thread(key, c['name'])).title = c['name'];
      }
    }
    for (final key in (d['conversations'] as List).cast<String>()) {
      threads.putIfAbsent(key, () => Thread(key, key));
    }
    people =
        (d['users'] as List)
            .map((u) => u['nickname'] as String)
            .where((n) => n != nickname)
            .toList()
          ..sort();
    catalog = {for (final c in channels) c['channel']: c['name']};
    changed();
  }

  Map<String, String> catalog = {};
  Future<void> _ready(int gen) async {
    try {
      await refreshDirectory();
      if (!_valid(gen)) return;
      if (active != null) unawaited(history(threads[active]!));
      final groups = threads.values.where((t) => t.group).toList();
      for (final t in groups.take(20)) {
        if (!_valid(gen) || !connected) break;
        if (!busy && !_mutedGroups.contains(t.target)) _join(t);
        await Future<void>.delayed(const Duration(milliseconds: 260));
      }
    } catch (e) {
      if (_valid(gen)) complain(e);
    }
  }

  void _join(Thread t) {
    if (!connected || t.joined || _joining.contains(t.target)) return;
    if (_joining.length + threads.values.where((v) => v.joined).length >= 20) {
      return;
    }
    _joining.add(t.target);
    _command({'type': 'join', 'channel': t.target});
  }

  void _event(Json e, int gen) {
    final channel = e['channel'] as String?;
    final t = threads[channel];
    switch (e['type']) {
      case 'ready':
        if (e['nickname'] != nickname) {
          expired();
          return;
        }
        connected = true;
        status = 'В сети';
        _attempts = 0;
        unawaited(_ready(gen));
      case 'join':
        if (e['nickname'] == nickname) {
          _joining.remove(channel);
          t?.joined = true;
        }
        t?.members.add(e['nickname']);
      case 'part':
        t?.members.remove(e['nickname']);
        if (e['nickname'] == nickname) t?.joined = false;
      case 'names':
        t?.members
          ?..clear()
          ..addAll((e['members'] as List).map((v) => v['nickname'] as String));
      case 'quit':
        for (final room in threads.values) {
          room.members.remove(e['nickname']);
        }
      case 'message':
        final dest = e['target'] as String, from = e['from'] as String;
        final peer = dest.startsWith('#') || from == nickname ? dest : from;
        final room = threads.putIfAbsent(
          peer,
          () => Thread(peer, catalog[peer] ?? peer),
        );
        if (room.merge(e) && peer != active && from != nickname) room.unread++;
        if (from == nickname &&
            _pending == (peer, e['text'], e['attachment']?['id'])) {
          if (_pending!.$3 == null && room.draft == e['text']) room.draft = '';
          _deadline?.cancel();
          _pending = null;
        }
      case 'error':
        _joining.clear();
        _deadline?.cancel();
        _pending = null;
        notice = codes[e['code']] ?? 'Сервер отклонил команду (${e['code']}).';
    }
    changed();
  }

  void _command(Json command) {
    _socket?.add(jsonEncode(command));
  }

  void open(String target) {
    _mutedGroups.remove(target);
    final t = threads.putIfAbsent(
      target,
      () => Thread(target, catalog[target] ?? target),
    );
    active = target;
    t.unread = 0;
    if (t.group) {
      _join(t);
      if (connected && !t.joined && !_joining.contains(t.target)) {
        notice = 'Открыто 20 групп. Покиньте одну через информацию о чате и выберите эту группу снова.';
      }
    }
    unawaited(history(t));
    changed();
  }

  void back() {
    active = null;
    changed();
  }

  void leave(Thread t) {
    if (t.group) {
      _mutedGroups.add(t.target);
      if (t.joined || _joining.contains(t.target)) {
        _command({'type': 'part', 'channel': t.target});
      }
      _joining.remove(t.target);
    }
    threads.remove(t.target);
    active = null;
    changed();
  }

  Future<void> history(Thread t, {bool older = false}) async {
    if (t.loading || older && t.before == null) return;
    t.loading = true;
    changed();
    try {
      final page = await api.get('/api/history', {
        'target': t.target,
        if (older) 'before': '${t.before}',
      });
      for (final m in (page['messages'] as List).cast<Json>()) {
        t.merge(m);
      }
      // Follow the returned page after reconnect, even if older pages were cached.
      t.before = page['nextBefore'] as int?;
    } catch (e) {
      complain(e);
    } finally {
      t.loading = false;
      changed();
    }
  }

  void send(Thread t, String text, {String? attachment}) {
    if (!canSend(t)) return;
    if (text.trim().isEmpty ||
        utf8.encode(text).length > 350 ||
        RegExp(r'[\x00-\x1f\x7f]').hasMatch(text)) {
      complain(const ClientError('Введите одну строку до 350 байт.'));
      return;
    }
    _pending = (t.target, text, attachment);
    _deadline = Timer(const Duration(seconds: 12), () {
      _pending = null;
      notice = codes['MESSAGE_TIMEOUT'];
      unawaited(history(t));
      changed();
    });
    _command({
      'type': 'message',
      'target': t.target,
      'text': text,
      'attachmentId': ?attachment,
    });
    changed();
  }

  Future<void> attach(Thread t, String name, Uint8List data) async {
    if (!canSend(t)) return;
    uploading = true;
    changed();
    try {
      final file = await api.upload('chat', name, data, target: t.target);
      uploading = false;
      if (!_closed && canSend(t)) send(t, 'Документ', attachment: file['id']);
    } catch (e) {
      complain(e);
    } finally {
      uploading = false;
      changed();
    }
  }

  @override
  void dispose() {
    _closed = true;
    _generation++;
    _retry?.cancel();
    _deadline?.cancel();
    unawaited(_socket?.close());
    api.close();
    super.dispose();
  }
}
