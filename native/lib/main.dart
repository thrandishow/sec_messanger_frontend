import 'dart:async';
import 'dart:convert';

import 'package:material_ui/material_ui.dart';

import 'api.dart';
import 'chat.dart';
import 'design.dart';
import 'files.dart';
import 'messenger.dart';
import 'session_vault.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ShifrApp());
}

class ShifrApp extends StatelessWidget {
  const ShifrApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Шифр-связь',
    debugShowCheckedModeBanner: false,
    theme: appTheme(),
    home: const SessionGate(),
  );
}

class SessionGate extends StatefulWidget {
  const SessionGate({super.key});
  @override
  State<SessionGate> createState() => _SessionGateState();
}

class _SessionGateState extends State<SessionGate> {
  final address = TextEditingController(),
      nick = TextEditingController(),
      password = TextEditingController();
  final vault = SessionVault();
  String? pem, certName, error;
  bool starting = true, busy = false, hidden = true;
  Chat? chat;
  @override
  void initState() {
    super.initState();
    unawaited(restore());
  }

  Future<void> restore() async {
    ChatApi? api;
    try {
      final text = await vault.read();
      if (text == null) return;
      final record = jsonDecode(text) as Json;
      address.text = record['server'];
      nick.text = record['nickname'] ?? '';
      pem = record['ca'];
      certName = pem == null ? null : 'ca.crt';
      if (record['token'] == null) return;
      api = ChatApi(
        serverAddress(address.text),
        caPem: pem,
        token: record['token'],
      );
      final me = await api.get('/api/auth/me');
      if (mounted) {
        enter(api, me['user']);
        api = null;
      }
    } catch (e) {
      error = errorMessage(e);
    } finally {
      api?.close();
      if (mounted) setState(() => starting = false);
    }
  }

  void enter(ChatApi api, Json user) {
    final model = Chat(api, user, () => unawaited(end(false)));
    setState(() {
      chat = model;
      error = null;
      password.clear();
    });
    unawaited(model.start());
  }

  Future<void> login() async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    ChatApi? api;
    try {
      final server = serverAddress(address.text);
      if (nick.text.trim().isEmpty || password.text.isEmpty) {
        throw const ClientError('Введите ник и пароль.');
      }
      api = ChatApi(server, caPem: pem);
      final user = await api.login(nick.text.trim(), password.text);
      String? warning;
      try {
        await vault.write(
          jsonEncode({
            'server': server.origin,
            'nickname': user['nickname'],
            'ca': pem,
            'token': api.token,
          }),
        );
      } catch (_) {
        warning = 'Хранилище ключей недоступно. После закрытия потребуется новый вход.';
      }
      if (!mounted) return;
      enter(api, user);
      api = null;
      if (warning != null) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(warning)));
      }
    } catch (e) {
      if (mounted) setState(() => error = errorMessage(e));
    } finally {
      api?.close();
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> end(bool logout) async {
    final old = chat;
    if (old == null || busy) return;
    setState(() => busy = true);
    try {
      if (logout) await old.api.post('/api/auth/logout', {});
    } catch (e) {
      if (e is! ClientError || e.status != 401) {
        if (mounted) {
          setState(() => busy = false);
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text(errorMessage(e))));
        }
        return;
      }
    }
    try {
      await vault.delete();
    } catch (_) {}
    if (!mounted) return;
    Navigator.of(context).popUntil((r) => r.isFirst);
    setState(() {
      chat = null;
      busy = false;
      error = logout ? null : 'Сессия завершилась. Войдите снова.';
    });
    old.dispose();
  }

  Future<void> certificate() async {
    try {
      final picked = await pickDocument(
        title: 'Выберите публичный ca.crt',
        maximum: 65536,
      );
      if (picked == null || !mounted) return;
      final text = utf8.decode(picked.$2);
      final probe = ChatApi(Uri.parse('https://localhost'), caPem: text);
      probe.close();
      setState(() {
        pem = text;
        certName = picked.$1;
        error = null;
      });
    } catch (e) {
      if (mounted) setState(() => error = errorMessage(e));
    }
  }

  @override
  void dispose() {
    chat?.dispose();
    address.dispose();
    nick.dispose();
    password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (starting) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (chat != null) return Messenger(chat: chat!, logout: () => end(true));
    return Scaffold(
      body: ChatPaper(
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 418),
                child: Card(
                  color: Colors.white,
                  elevation: 2,
                  shadowColor: const Color(0x4480a6a1),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(26),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(28),
                    child: AutofillGroup(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Align(
                            alignment: Alignment.centerLeft,
                            child: Container(
                              width: 60,
                              height: 60,
                              decoration: const BoxDecoration(
                                shape: BoxShape.circle,
                                gradient: LinearGradient(
                                  colors: [
                                    Color(0xff64c9e9),
                                    Color(0xff197eb4),
                                  ],
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                ),
                              ),
                              child: const Icon(
                                Icons.send_rounded,
                                color: Colors.white,
                                size: 31,
                              ),
                            ),
                          ),
                          const SizedBox(height: 18),
                          const Text(
                            'Шифр-связь',
                            style: TextStyle(
                              fontSize: 32,
                              fontWeight: FontWeight.w700,
                              letterSpacing: -1,
                            ),
                          ),
                          const Text(
                            'Вход на сервер вашей локальной сети',
                            style: TextStyle(color: muted),
                          ),
                          const SizedBox(height: 24),
                          TextField(
                            controller: address,
                            enabled: !busy,
                            keyboardType: TextInputType.url,
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              labelText: 'Адрес сервера',
                              hintText: '192.168.1.10:8443',
                              prefixIcon: Icon(Icons.dns_outlined),
                            ),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: nick,
                            enabled: !busy,
                            autocorrect: false,
                            autofillHints: const [AutofillHints.username],
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              labelText: 'Ник',
                              prefixIcon: Icon(Icons.alternate_email),
                            ),
                          ),
                          const SizedBox(height: 10),
                          TextField(
                            controller: password,
                            enabled: !busy,
                            obscureText: hidden,
                            autofillHints: const [AutofillHints.password],
                            onSubmitted: (_) => login(),
                            decoration: InputDecoration(
                              labelText: 'Пароль',
                              prefixIcon: const Icon(Icons.lock_outline),
                              suffixIcon: IconButton(
                                tooltip: hidden
                                    ? 'Показать пароль'
                                    : 'Скрыть пароль',
                                onPressed: () =>
                                    setState(() => hidden = !hidden),
                                icon: Icon(
                                  hidden
                                      ? Icons.visibility_outlined
                                      : Icons.visibility_off_outlined,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              Expanded(
                                child: TextButton.icon(
                                  onPressed: busy ? null : certificate,
                                  icon: const Icon(
                                    Icons.verified_user_outlined,
                                    size: 17,
                                  ),
                                  label: Text(
                                    certName ?? 'Выбрать сертификат CA',
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ),
                              if (pem != null)
                                IconButton(
                                  tooltip: 'Убрать сертификат',
                                  onPressed: () => setState(() {
                                    pem = null;
                                    certName = null;
                                  }),
                                  icon: const Icon(Icons.close, size: 17),
                                ),
                            ],
                          ),
                          if (error != null)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              child: Text(
                                error!,
                                style: TextStyle(
                                  color: Theme.of(context).colorScheme.error,
                                ),
                              ),
                            ),
                          FilledButton(
                            onPressed: busy ? null : login,
                            style: FilledButton.styleFrom(
                              minimumSize: const Size.fromHeight(48),
                            ),
                            child: Text(busy ? 'Подключение…' : 'Войти'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
