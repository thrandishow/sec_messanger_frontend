import 'dart:async';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat.dart';
import 'design.dart';
import 'files.dart';
import 'organization.dart';

class Messenger extends StatefulWidget {
  final Chat chat;
  final Future<void> Function() logout;
  const Messenger({super.key, required this.chat, required this.logout});
  @override
  State<Messenger> createState() => _MessengerState();
}

class _MessengerState extends State<Messenger> {
  String query = '';
  bool groupsOnly = false;
  Chat get chat => widget.chat;
  @override
  void initState() {
    super.initState();
    chat.addListener(update);
  }

  @override
  void dispose() {
    chat.removeListener(update);
    super.dispose();
  }

  void update() {
    if (!mounted) return;
    setState(() {});
    final msg = chat.notice;
    if (msg != null) {
      chat.consumeNotice();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(msg)));
        }
      });
    }
  }

  Future<void> contacts() async {
    try {
      await chat.refreshDirectory();
    } catch (e) {
      chat.complain(e);
      return;
    }
    if (!mounted) return;
    String search = '';
    final selected = await showDialog<String>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) {
          final entries =
              {
                ...chat.catalog,
                for (final user in chat.people) user: user,
              }.entries.where(
                (e) => ('${e.key} ${e.value}').toLowerCase().contains(
                  search.toLowerCase(),
                ),
              );
          return AlertDialog(
            title: const Text('Новый диалог'),
            content: SizedBox(
              width: 360,
              height: 370,
              child: Column(
                children: [
                  TextField(
                    autofocus: true,
                    onChanged: (v) => set(() => search = v),
                    decoration: const InputDecoration(
                      hintText: 'Имя или название',
                      prefixIcon: Icon(Icons.search),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Expanded(
                    child: entries.isEmpty
                        ? const Center(child: Text('Никого не найдено'))
                        : ListView(
                            children: entries
                                .map(
                                  (e) => ListTile(
                                    leading: Avatar(
                                      e.value,
                                      group: e.key.startsWith('#'),
                                      size: 36,
                                    ),
                                    title: Text(e.value),
                                    onTap: () => Navigator.pop(c, e.key),
                                  ),
                                )
                                .toList(),
                          ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(c),
                child: const Text('Закрыть'),
              ),
            ],
          );
        },
      ),
    );
    if (selected != null && mounted) chat.open(selected);
  }

  void menu(String action) {
    switch (action) {
      case 'new':
        unawaited(contacts());
      case 'resources':
        Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => Resources(chat: chat)),
        );
      case 'admin':
        Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => Organization(chat: chat)),
        );
      case 'retry':
        unawaited(chat.start());
      case 'logout':
        unawaited(widget.logout());
    }
  }

  Widget sidebar() {
    final results =
        chat.threads.values
            .where(
              (t) =>
                  (!groupsOnly || t.group) &&
                  ('${t.title} ${t.target}').toLowerCase().contains(
                    query.toLowerCase(),
                  ),
            )
            .toList()
          ..sort((a, b) {
            final ordering = (b.latest?['time'] as String? ?? '').compareTo(
              a.latest?['time'] as String? ?? '',
            );
            if (ordering != 0) return ordering;
            if (a.target == '#general') return -1;
            if (b.target == '#general') return 1;
            return a.title.compareTo(b.title);
          });
    return ColoredBox(
      color: Colors.white,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 12, 8),
            child: Row(
              children: [
                PopupMenuButton<String>(
                  tooltip: 'Меню аккаунта',
                  onSelected: menu,
                  itemBuilder: (_) => [
                    PopupMenuItem(
                      enabled: false,
                      child: Text('@${chat.nickname}'),
                    ),
                    const PopupMenuItem(
                      value: 'resources',
                      child: Text('Полезные ресурсы'),
                    ),
                    if (chat.admin)
                      const PopupMenuItem(
                        value: 'admin',
                        child: Text('Управление организацией'),
                      ),
                    const PopupMenuItem(
                      value: 'retry',
                      child: Text('Переподключиться'),
                    ),
                    const PopupMenuItem(value: 'logout', child: Text('Выйти')),
                  ],
                  child: Avatar(chat.nickname, size: 38),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Чаты',
                        style: TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -.9,
                        ),
                      ),
                      Row(
                        children: [
                          Container(
                            width: 6,
                            height: 6,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: chat.connected
                                  ? const Color(0xff43ae7b)
                                  : Colors.orange,
                            ),
                          ),
                          const SizedBox(width: 5),
                          Expanded(
                            child: Text(
                              chat.status,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12,
                                color: muted,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                IconButton.filledTonal(
                  tooltip: 'Новый диалог',
                  onPressed: contacts,
                  icon: const Icon(Icons.edit_outlined, size: 20),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
            child: TextField(
              onChanged: (v) => setState(() => query = v),
              decoration: const InputDecoration(
                hintText: 'Поиск чатов',
                prefixIcon: Icon(Icons.search, size: 20),
                isDense: true,
                contentPadding: EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 6, 12, 9),
            child: Row(
              children: [
                for (final item in [(false, 'Все чаты'), (true, 'Группы')])
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      selected: groupsOnly == item.$1,
                      label: Text(item.$2),
                      showCheckmark: false,
                      onSelected: (_) => setState(() => groupsOnly = item.$1),
                      side: BorderSide.none,
                      selectedColor: const Color(0xffdcf0fb),
                      backgroundColor: const Color(0xfff2f5f6),
                      labelStyle: TextStyle(
                        color: groupsOnly == item.$1
                            ? const Color(0xff1478ad)
                            : muted,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const Divider(height: 1, color: Color(0xffe1e8eb)),
          Expanded(
            child: results.isEmpty
                ? Center(
                    child: Text(
                      query.isEmpty ? 'Пока нет чатов' : 'Ничего не найдено',
                      style: const TextStyle(color: muted),
                    ),
                  )
                : ListView.builder(
                    itemCount: results.length,
                    itemBuilder: (c, i) {
                      final t = results[i], m = t.latest;
                      final preview = t.draft.isNotEmpty
                          ? 'Черновик: ${t.draft}'
                          : m != null
                          ? '${m['from'] == chat.nickname
                                ? 'Вы: '
                                : t.group
                                ? "${m['from']}: "
                                : ''}${m['attachment']?['name'] ?? m['text']}'
                          : t.group
                          ? t.target
                          : 'Личный диалог';
                      return Material(
                        color: chat.active == t.target
                            ? const Color(0xffe3f2fa)
                            : Colors.transparent,
                        child: InkWell(
                          onTap: () => chat.open(t.target),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 12,
                            ),
                            child: Row(
                              children: [
                                Avatar(t.title, group: t.group, size: 48),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        t.title,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w700,
                                          fontSize: 16,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        preview,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          color: t.draft.isEmpty
                                              ? muted
                                              : const Color(0xffa85835),
                                          fontSize: 13,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text(
                                      clockLabel(m?['time']),
                                      style: const TextStyle(
                                        fontSize: 11,
                                        color: muted,
                                      ),
                                    ),
                                    if (t.unread > 0)
                                      Badge(
                                        backgroundColor: blue,
                                        label: Text('${t.unread}'),
                                      ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      final wide = box.maxWidth >= 760;
      final selected = chat.threads[chat.active];
      Widget list = sidebar();
      Widget detail = selected == null
          ? const ChatPaper(
              child: Center(
                child: Chip(
                  label: Text('Выберите чат для переписки'),
                  side: BorderSide.none,
                ),
              ),
            )
          : Conversation(
              key: ValueKey(selected.target),
              chat: chat,
              thread: selected,
              wide: wide,
            );
      return PopScope(
        canPop: wide || selected == null,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop && !wide) chat.back();
        },
        child: Scaffold(
          body: SafeArea(
            child: wide
                ? Row(
                    children: [
                      SizedBox(
                        width: box.maxWidth >= 1100 ? 346 : 294,
                        child: list,
                      ),
                      const VerticalDivider(
                        width: 1,
                        thickness: 1,
                        color: Color(0xffd6e1e5),
                      ),
                      Expanded(child: detail),
                    ],
                  )
                : selected == null
                ? list
                : detail,
          ),
        ),
      );
    },
  );
}

class Conversation extends StatefulWidget {
  final Chat chat;
  final Thread thread;
  final bool wide;
  const Conversation({
    super.key,
    required this.chat,
    required this.thread,
    required this.wide,
  });
  @override
  State<Conversation> createState() => _ConversationState();
}

class _ConversationState extends State<Conversation> {
  late final TextEditingController editor;
  final scroll = ScrollController();
  Thread get t => widget.thread;
  Chat get chat => widget.chat;
  @override
  void initState() {
    super.initState();
    editor = TextEditingController(text: t.draft);
  }

  @override
  void didUpdateWidget(Conversation old) {
    super.didUpdateWidget(old);
    if (editor.text != t.draft) {
      editor.value = TextEditingValue(
        text: t.draft,
        selection: TextSelection.collapsed(offset: t.draft.length),
      );
    }
  }

  @override
  void dispose() {
    editor.dispose();
    scroll.dispose();
    super.dispose();
  }

  Future<void> attachment() async {
    try {
      final file = await pickDocument();
      if (file != null && mounted) await chat.attach(t, file.$1, file.$2);
    } catch (e) {
      chat.complain(e);
    }
  }

  void info() {
    showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(t.title),
        content: SizedBox(
          width: 300,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  t.group ? t.target : '@${t.target}',
                  style: const TextStyle(color: muted),
                ),
                if (t.group) ...[
                  const SizedBox(height: 16),
                  Text('Участники в сети · ${t.members.length}'),
                  for (final member in t.members.toList()..sort())
                    ListTile(
                      leading: Avatar(member, size: 30),
                      title: Text(member),
                      onTap: member == chat.nickname
                          ? null
                          : () {
                              Navigator.pop(c);
                              chat.open(member);
                            },
                    ),
                ],
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(c);
              chat.leave(t);
            },
            child: Text(t.group ? 'Покинуть группу' : 'Закрыть диалог'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const Text('Готово'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final messages = t.messages;
    final readOnly = t.target == '#announcements' && !chat.moderator;
    final online = chat.connected;
    return Column(
      children: [
        Material(
          color: Colors.white,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(10, 10, 12, 10),
            child: Row(
              children: [
                if (!widget.wide)
                  IconButton(
                    tooltip: 'Назад к чатам',
                    onPressed: chat.back,
                    icon: const Icon(Icons.arrow_back),
                  ),
                Avatar(t.title, group: t.group, size: 40),
                const SizedBox(width: 12),
                Expanded(
                  child: InkWell(
                    onTap: info,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          t.title,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: 17,
                          ),
                        ),
                        Text(
                          !online
                              ? chat.status
                              : t.group
                              ? t.joined
                                    ? 'Участников в сети: ${t.members.length}'
                                    : 'Подключение к группе…'
                              : 'Личный диалог',
                          style: const TextStyle(color: muted, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Информация о чате',
                  onPressed: info,
                  icon: const Icon(Icons.info_outline),
                ),
              ],
            ),
          ),
        ),
        Expanded(
          child: ChatPaper(
            child: messages.isEmpty
                ? Center(
                    child: t.loading
                        ? const CircularProgressIndicator()
                        : const Chip(
                            label: Text('В этом чате пока нет сообщений'),
                            side: BorderSide.none,
                          ),
                  )
                : ListView.builder(
                    reverse: true,
                    controller: scroll,
                    padding: EdgeInsets.symmetric(
                      horizontal: widget.wide ? 26 : 12,
                      vertical: 14,
                    ),
                    itemCount: messages.length + (t.before != null ? 1 : 0),
                    itemBuilder: (context, rev) {
                      if (rev == messages.length) {
                        return Center(
                          child: TextButton(
                            onPressed: t.loading
                                ? null
                                : () => chat.history(t, older: true),
                            child: const Text('Более ранние сообщения'),
                          ),
                        );
                      }
                      final i = messages.length - 1 - rev, m = messages[i];
                      final date = dateLabel(m['time']);
                      return Column(
                        children: [
                          if (i == 0 ||
                              date != dateLabel(messages[i - 1]['time']))
                            Container(
                              margin: const EdgeInsets.symmetric(vertical: 12),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 12,
                                vertical: 4,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(0xff75938b),
                                borderRadius: BorderRadius.circular(16),
                              ),
                              child: Text(
                                date,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          MessageBubble(
                            message: m,
                            own: m['from'] == chat.nickname,
                            group: t.group,
                            download: (f) async {
                              try {
                                await saveDocument(chat.api, f);
                              } catch (e) {
                                chat.complain(e);
                              }
                            },
                          ),
                        ],
                      );
                    },
                  ),
          ),
        ),
        Material(
          color: Colors.white,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            child: readOnly
                ? const Padding(
                    padding: EdgeInsets.all(10),
                    child: Text(
                      'Публикуют модераторы и администраторы',
                      style: TextStyle(color: muted),
                    ),
                  )
                : Row(
                    children: [
                      IconButton(
                        tooltip: 'Прикрепить документ',
                        onPressed: chat.canSend(t) ? attachment : null,
                        icon: const Icon(Icons.attach_file_rounded),
                      ),
                      Expanded(
                        child: TextField(
                          controller: editor,
                          onChanged: (s) {
                            t.draft = s;
                          },
                          onSubmitted: (_) => chat.send(t, editor.text),
                          textInputAction: TextInputAction.send,
                          decoration: InputDecoration(
                            isDense: true,
                            hintText: online
                                ? 'Сообщение'
                                : 'Нет связи с сервером',
                            fillColor: Colors.white,
                          ),
                        ),
                      ),
                      IconButton.filled(
                        tooltip: 'Отправить',
                        onPressed: chat.canSend(t)
                            ? () => chat.send(t, editor.text)
                            : null,
                        icon: chat.busy
                            ? const SizedBox.square(
                                dimension: 17,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.send_rounded, size: 20),
                      ),
                    ],
                  ),
          ),
        ),
      ],
    );
  }
}

class MessageBubble extends StatelessWidget {
  final Json message;
  final bool own, group;
  final void Function(Json) download;
  const MessageBubble({
    super.key,
    required this.message,
    required this.own,
    required this.group,
    required this.download,
  });
  @override
  Widget build(BuildContext context) {
    final file = message['attachment'] as Json?;
    return Align(
      alignment: own ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: (MediaQuery.sizeOf(context).width * .74).clamp(150, 510),
        ),
        margin: const EdgeInsets.symmetric(vertical: 2),
        padding: const EdgeInsets.fromLTRB(12, 8, 10, 5),
        decoration: BoxDecoration(
          color: own ? const Color(0xffd5f6bc) : Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(15),
            topRight: const Radius.circular(15),
            bottomLeft: Radius.circular(own ? 15 : 3),
            bottomRight: Radius.circular(own ? 3 : 15),
          ),
          boxShadow: const [
            BoxShadow(
              color: Color(0x16000000),
              offset: Offset(0, 1),
              blurRadius: 1,
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (group && !own)
              Text(
                message['from'],
                style: const TextStyle(
                  fontSize: 12,
                  color: Color(0xff277e99),
                  fontWeight: FontWeight.w700,
                ),
              ),
            if (file != null)
              TextButton.icon(
                onPressed: () => download(file),
                icon: const Icon(Icons.file_download_outlined),
                label: Text("${file['name']} · ${fileSize(file['size'])}"),
              ),
            if (file == null || message['text'] != 'Документ')
              SelectableText(
                message['text'],
                style: const TextStyle(fontSize: 15, height: 1.35),
              ),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  clockLabel(message['time']),
                  style: const TextStyle(fontSize: 10, color: muted),
                ),
                if (own) ...[
                  const SizedBox(width: 3),
                  const Tooltip(
                    message: 'Сохранено на сервере',
                    child: Icon(
                      Icons.check,
                      size: 14,
                      color: Color(0xff579053),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}
