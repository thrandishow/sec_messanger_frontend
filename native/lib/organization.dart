import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat.dart';
import 'design.dart';
import 'files.dart';

class Resources extends StatefulWidget {
  final Chat chat;
  const Resources({super.key, required this.chat});
  @override
  State<Resources> createState() => _ResourcesState();
}

class _ResourcesState extends State<Resources> {
  List<Json> files = [];
  bool busy = false;
  String? error;
  Future<void> run(Future<void> Function() f) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await f();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> refresh() async {
    files = ((await widget.chat.api.get('/api/resources'))['files'] as List)
        .cast<Json>();
  }

  @override
  void initState() {
    super.initState();
    unawaited(run(refresh));
  }

  Future<void> remove(Json file) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Удалить ресурс?'),
        content: Text(file['name']),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Удалить'),
          ),
        ],
      ),
    );
    if (yes == true && mounted) {
      await run(() async {
        await widget.chat.api.post("/api/resources/${file['id']}/delete", {});
        await refresh();
      });
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Полезные ресурсы'),
      actions: [
        IconButton(
          tooltip: 'Обновить',
          onPressed: busy ? null : () => run(refresh),
          icon: const Icon(Icons.refresh),
        ),
        if (widget.chat.moderator)
          IconButton(
            tooltip: 'Добавить документ',
            icon: const Icon(Icons.upload_file),
            onPressed: busy
                ? null
                : () => run(() async {
                    final f = await pickDocument();
                    if (f != null) {
                      await widget.chat.api.upload('resource', f.$1, f.$2);
                      await refresh();
                    }
                  }),
          ),
      ],
    ),
    body: Column(
      children: [
        if (busy) const LinearProgressIndicator(),
        if (error != null) ListTile(title: Text(error!)),
        Expanded(
          child: files.isEmpty
              ? const Center(child: Text('Документов пока нет'))
              : ListView(
                  children: [
                    for (final f in files)
                      ListTile(
                        leading: const CircleAvatar(
                          child: Icon(Icons.description_outlined),
                        ),
                        title: Text(f['name']),
                        subtitle: Text(fileSize(f['size'])),
                        onTap: busy
                            ? null
                            : () => run(() => saveDocument(widget.chat.api, f)),
                        trailing: widget.chat.moderator
                            ? IconButton(
                                tooltip: 'Удалить',
                                onPressed: busy ? null : () => remove(f),
                                icon: const Icon(Icons.delete_outline),
                              )
                            : null,
                      ),
                  ],
                ),
        ),
      ],
    ),
  );
}

const roleNames = {
  'member': 'Сотрудник',
  'moderator': 'Модератор',
  'admin': 'Администратор',
};

class Organization extends StatefulWidget {
  final Chat chat;
  const Organization({super.key, required this.chat});
  @override
  State<Organization> createState() => _OrganizationState();
}

class _OrganizationState extends State<Organization> {
  List<Json> users = [], departments = [], audit = [];
  int? before;
  bool busy = false;
  String? error;
  int tab = 0;
  ChatApi get api => widget.chat.api;
  Future<void> run(Future<void> Function() task) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await task();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> directory() async {
    final data = await api.get('/api/admin/users');
    users = (data['users'] as List).cast<Json>();
    departments = (data['departments'] as List).cast<Json>();
  }

  Future<void> entries({bool older = false}) async {
    final page = await api.get('/api/admin/audit', {
      if (older) 'before': '$before',
    });
    audit = [if (older) ...audit, ...(page['entries'] as List).cast<Json>()];
    before = page['nextBefore'];
  }

  @override
  void initState() {
    super.initState();
    unawaited(run(directory));
  }

  Future<void> edit([Json? user]) async {
    final result = await showDialog<Json>(
      context: context,
      builder: (_) => AccountDialog(user: user, departments: departments),
    );
    if (result == null || !mounted) return;
    await run(() async {
      await api.post(
        user == null ? '/api/admin/users' : "/api/admin/users/${user['id']}",
        result,
      );
      await directory();
      await widget.chat.refreshDirectory();
    });
  }

  Future<void> createDepartment() async {
    var name = '', channel = '';
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Новый отдел'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Название'),
              onChanged: (v) => name = v,
            ),
            const SizedBox(height: 8),
            TextField(
              decoration: const InputDecoration(
                labelText: 'Канал',
                hintText: '#finance',
              ),
              onChanged: (v) => channel = v,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const Text('Отмена'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Создать'),
          ),
        ],
      ),
    );
    if (yes != true || !mounted) return;
    await run(() async {
      await api.post('/api/admin/departments', {
        'name': name.trim(),
        'channel': '#${channel.trim().replaceFirst(RegExp(r"^#"), "")}',
      });
      await directory();
      await widget.chat.refreshDirectory();
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Организация'),
      actions: [
        IconButton(
          tooltip: 'Обновить',
          onPressed: busy ? null : () => run(tab == 2 ? entries : directory),
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    bottomNavigationBar: NavigationBar(
      selectedIndex: tab,
      onDestinationSelected: busy
          ? null
          : (i) {
              setState(() => tab = i);
              if (i == 2) unawaited(run(entries));
            },
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.people_outline),
          label: 'Сотрудники',
        ),
        NavigationDestination(icon: Icon(Icons.work_outline), label: 'Отделы'),
        NavigationDestination(
          icon: Icon(Icons.receipt_long_outlined),
          label: 'Аудит',
        ),
      ],
    ),
    body: Column(
      children: [
        if (busy) const LinearProgressIndicator(),
        if (error != null) ListTile(title: Text(error!)),
        Expanded(
          child: ListView(
            children: [
              if (tab == 0) ...[
                ListTile(
                  leading: const Icon(Icons.person_add_alt),
                  title: const Text('Создать аккаунт'),
                  onTap: busy ? null : () => edit(),
                ),
                for (final u in users)
                  ListTile(
                    leading: Avatar(u['nickname']),
                    title: Text(u['nickname']),
                    subtitle: Text(
                      "${roleNames[u['role']]} · ${u['department'] ?? 'Без отдела'}${u['active'] == 0 ? ' · Заблокирован' : ''}",
                    ),
                    trailing: const Icon(Icons.edit_outlined),
                    onTap: busy ? null : () => edit(u),
                  ),
              ],
              if (tab == 1) ...[
                ListTile(
                  leading: const Icon(Icons.add),
                  title: const Text('Создать отдел'),
                  onTap: busy ? null : createDepartment,
                ),
                for (final d in departments)
                  ListTile(
                    leading: Avatar(d['name'], group: true),
                    title: Text(d['name']),
                    subtitle: Text(d['channel']),
                  ),
              ],
              if (tab == 2) ...[
                for (final entry in audit)
                  ListTile(
                    title: Text(entry['action']),
                    subtitle: Text(
                      "${entry['nickname'] ?? 'Система'} · ${entry['ip']}\n${entry['subject'] ?? ''}",
                    ),
                    trailing: Text(
                      "${dateLabel(entry['time'])}\n${clockLabel(entry['time'])}",
                      textAlign: TextAlign.end,
                    ),
                  ),
                if (before != null)
                  TextButton(
                    onPressed: busy
                        ? null
                        : () => run(() => entries(older: true)),
                    child: const Text('Более ранние события'),
                  ),
              ],
            ],
          ),
        ),
      ],
    ),
  );
}

class AccountDialog extends StatefulWidget {
  final Json? user;
  final List<Json> departments;
  const AccountDialog({super.key, this.user, required this.departments});
  @override
  State<AccountDialog> createState() => _AccountDialogState();
}

class _AccountDialogState extends State<AccountDialog> {
  String nickname = '', password = '';
  late String role, dept;
  late bool active;
  final form = GlobalKey<FormState>();
  @override
  void initState() {
    super.initState();
    role = widget.user?['role'] ?? 'member';
    dept = widget.user?['department'] ?? '';
    active = widget.user?['active'] != 0;
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.user != null;
    return AlertDialog(
      title: Text(
        editing ? "Изменить @${widget.user!['nickname']}" : 'Создать аккаунт',
      ),
      content: Form(
        key: form,
        child: SizedBox(
          width: 330,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (!editing)
                  TextFormField(
                    decoration: const InputDecoration(labelText: 'Ник'),
                    onChanged: (v) => nickname = v,
                    validator: (v) =>
                        RegExp(r'^[A-Za-z][A-Za-z0-9_]{2,23}$')
                            .hasMatch(v ?? '')
                        ? null
                        : '3–24 символа, начните с буквы',
                  ),
                const SizedBox(height: 8),
                TextFormField(
                  obscureText: true,
                  decoration: InputDecoration(
                    labelText: editing
                        ? 'Новый пароль (необязательно)'
                        : 'Пароль',
                  ),
                  onChanged: (v) => password = v,
                  validator: (v) =>
                      editing && password.isEmpty ||
                          password.length >= 12 && password.length <= 128
                      ? null
                      : 'От 12 до 128 символов',
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: role,
                  decoration: const InputDecoration(labelText: 'Роль'),
                  items: roleNames.entries
                      .map(
                        (e) => DropdownMenuItem(
                          value: e.key,
                          child: Text(e.value),
                        ),
                      )
                      .toList(),
                  onChanged: (v) => setState(() => role = v!),
                ),
                const SizedBox(height: 8),
                DropdownButtonFormField<String>(
                  initialValue: dept,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Отдел'),
                  items: [
                    const DropdownMenuItem(
                      value: '',
                      child: Text('Без отдела'),
                    ),
                    for (final d in widget.departments)
                      DropdownMenuItem(
                        value: d['channel'] as String,
                        child: Text(d['name']),
                      ),
                  ],
                  onChanged: (v) => setState(() => dept = v!),
                ),
                if (editing)
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Аккаунт активен'),
                    value: active,
                    onChanged: (v) => setState(() => active = v),
                  ),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: () {
            if (!form.currentState!.validate()) return;
            Navigator.pop(context, <String, dynamic>{
              'role': role,
              'department': dept.isEmpty ? null : dept,
              if (!editing) 'nickname': nickname,
              if (!editing || password.isNotEmpty) 'password': password,
              if (editing) 'active': active,
            });
          },
          child: const Text('Сохранить'),
        ),
      ],
    );
  }
}
