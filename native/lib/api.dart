import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

typedef Json = Map<String, dynamic>;
const fileLimit = 10 * 1024 * 1024;

Uri serverAddress(String value) {
  final raw = value.trim();
  final uri = Uri.tryParse(raw.contains('://') ? raw : 'https://$raw');
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.userInfo.isNotEmpty ||
      uri.hasQuery ||
      uri.hasFragment ||
      (uri.path.isNotEmpty && uri.path != '/')) {
    throw const ClientError('Укажите HTTPS-адрес сервера в локальной сети.');
  }
  final host = uri.host;
  final addr = InternetAddress.tryParse(host);
  if (host != 'localhost' &&
      (addr == null ||
          addr.type != InternetAddressType.IPv4 ||
          !(addr.isLoopback ||
              addr.rawAddress[0] == 10 ||
              (addr.rawAddress[0] == 192 && addr.rawAddress[1] == 168) ||
              (addr.rawAddress[0] == 172 &&
                  addr.rawAddress[1] >= 16 &&
                  addr.rawAddress[1] <= 31)))) {
    throw const ClientError(
      'Нужен локальный IPv4 сервера, например 192.168.1.10.',
    );
  }
  final port = uri.hasPort || raw.contains('://') || raw.contains(':')
      ? uri.port
      : 8443;
  if (port < 1 || port > 65535) {
    throw const ClientError('Проверьте порт сервера.');
  }
  return Uri(scheme: 'https', host: host, port: port);
}

class ClientError implements Exception {
  final String message;
  final int? status;
  const ClientError(this.message, [this.status]);
  @override
  String toString() => message;
}

String errorMessage(Object error) {
  if (error is ClientError) return error.message;
  if (error is HandshakeException || error is TlsException) {
    return 'Проверьте адрес сервера и корневой сертификат ca.crt.';
  }
  if (error is TimeoutException ||
      error is SocketException ||
      error is HttpException ||
      error is WebSocketException) {
    return 'Нет связи с сервером. Проверьте локальную сеть.';
  }
  return 'Не удалось выполнить операцию.';
}

const codes = {
  'INVALID_CREDENTIALS': 'Неверный ник или пароль.',
  'UNAUTHORIZED': 'Сессия завершилась. Войдите снова.',
  'FORBIDDEN': 'Недостаточно прав.',
  'INVALID_INPUT': 'Проверьте введённые данные.',
  'ORIGIN_DENIED': 'Адрес приложения отсутствует в ALLOWED_ORIGINS сервера.',
  'NICKNAME_TAKEN': 'Этот ник уже занят.',
  'LAST_ADMIN': 'Это последний активный администратор.',
  'NOT_FOUND': 'Файл или чат недоступен.',
  'ALREADY_EXISTS': 'Такой отдел уже существует.',
  'STORAGE_FULL': 'На сервере закончилась квота файлов.',
  'MESSAGE_PENDING': 'Дождитесь подтверждения отправки.',
  'BROKER_RECIPIENT_OFFLINE':
      'Собеседник офлайн. Сообщение осталось в черновике.',
  'NOT_JOINED': 'Дождитесь входа в группу.',
  'BROKER_ROOM_LIMIT': 'Достигнут лимит в 20 открытых групп.',
  'BROKER_ROOM_FULL': 'В группе уже 512 участников онлайн.',
  'BROKER_UNAVAILABLE': 'Сервер сообщений недоступен.',
  'MESSAGE_TIMEOUT':
      'Подтверждение не пришло. Перед повтором проверьте историю.',
};

class ChatApi {
  final Uri server;
  final HttpClient _http;
  String? token;
  ChatApi(this.server, {String? caPem, this.token})
    : _http = HttpClient(context: _context(caPem)) {
    _http.connectionTimeout = const Duration(seconds: 8);
    _http.findProxy = (_) => 'DIRECT';
  }

  static SecurityContext _context(String? pem) {
    final context = SecurityContext(withTrustedRoots: true);
    if (pem != null && pem.isNotEmpty) {
      final cert = RegExp(
        r'^\s*-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----\s*$',
      ).firstMatch(pem);
      if (cert == null) {
        throw const ClientError('Выберите публичный PEM-сертификат ca.crt.');
      }
      try {
        final bytes = Platform.isIOS
            ? base64.decode(cert[1]!.replaceAll(RegExp(r'\s'), ''))
            : utf8.encode(pem);
        context.setTrustedCertificatesBytes(bytes);
      } catch (_) {
        throw const ClientError('Не удалось прочитать сертификат CA.');
      }
    }
    return context;
  }

  Future<HttpClientResponse> _request(
    String path, {
    Map<String, String>? query,
    Object? json,
    Uint8List? bytes,
  }) async {
    final method = json != null || bytes != null ? 'POST' : 'GET';
    final req = await _http
        .openUrl(method, server.replace(path: path, queryParameters: query))
        .timeout(const Duration(seconds: 12));
    req.followRedirects = false;
    req.headers.set('Origin', server.origin);
    if (token != null) req.cookies.add(Cookie('shifr_session', token!));
    if (bytes != null) {
      req.headers.contentType = ContentType.binary;
      req.contentLength = bytes.length;
      req.add(bytes);
    } else if (json != null) {
      req.headers.contentType = ContentType.json;
      req.add(utf8.encode(jsonEncode(json)));
    }
    final res = await req.close().timeout(const Duration(seconds: 35));
    if (res.statusCode < 200 || res.statusCode >= 300) {
      final raw = await utf8.decoder
          .bind(res)
          .join()
          .timeout(const Duration(seconds: 10));
      String? code;
      try {
        code = (jsonDecode(raw) as Json)['error'] as String?;
      } catch (_) {}
      throw ClientError(
        codes[code] ??
            (res.statusCode == 429
                ? 'Слишком много запросов. Подождите минуту.'
                : 'Запрос отклонён сервером (${res.statusCode}).'),
        res.statusCode,
      );
    }
    return res;
  }

  Future<Json> _json(HttpClientResponse response) async {
    final raw = await utf8.decoder
        .bind(response)
        .join()
        .timeout(const Duration(seconds: 20));
    return raw.isEmpty ? {} : jsonDecode(raw) as Json;
  }

  Future<Json> get(String path, [Map<String, String>? query]) async =>
      _json(await _request(path, query: query));
  Future<Json> post(String path, Json body) async =>
      _json(await _request(path, json: body));
  Future<Json> login(String nickname, String password) async {
    final res = await _request(
      '/api/auth/login',
      json: {'nickname': nickname, 'password': password},
    );
    final data = await _json(res);
    token = res.cookies
        .where((c) => c.name == 'shifr_session')
        .firstOrNull
        ?.value;
    if (token == null) throw const ClientError('Сервер не выдал сессию.');
    return data['user'] as Json;
  }

  Future<WebSocket> connect() async {
    final socket = await WebSocket.connect(
      server.replace(scheme: 'wss', path: '/ws').toString(),
      customClient: _http,
      headers: {'Origin': server.origin, 'Cookie': 'shifr_session=$token'},
    );
    socket.pingInterval = const Duration(seconds: 25);
    return socket;
  }

  Future<Json> upload(
    String scope,
    String name,
    Uint8List bytes, {
    String? target,
  }) async {
    if (bytes.isEmpty || bytes.length > fileLimit) {
      throw const ClientError('Размер файла — от 1 байта до 10 МиБ.');
    }
    final res = await _request(
      '/api/files',
      query: {'name': name, 'scope': scope, 'target': ?target},
      bytes: bytes,
    );
    return (await _json(res))['file'] as Json;
  }

  Future<Uint8List> download(String id) async {
    final res = await _request('/api/files/${Uri.encodeComponent(id)}');
    final bytes = BytesBuilder(copy: false);
    await for (final chunk in res.timeout(const Duration(seconds: 20))) {
      if (bytes.length + chunk.length > fileLimit) {
        throw const ClientError('Файл превышает 10 МиБ.');
      }
      bytes.add(chunk);
    }
    return bytes.takeBytes();
  }

  void close() => _http.close(force: true);
}
