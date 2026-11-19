import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SessionVault {
  static const _storage = FlutterSecureStorage(
    mOptions: MacOsOptions(usesDataProtectionKeychain: false),
  );
  static const _attributes = [
    'application',
    'ru.shifrsvyaz.shifr_client',
    'key',
    'account',
  ];

  // Keep Linux keyring failures isolated from the GTK process. The session is
  // passed on stdin so it is never visible in the process argument list.
  Future<String?> read() async {
    if (!Platform.isLinux) return _storage.read(key: 'account');
    try {
      final result = await Process.run('secret-tool', [
        'lookup',
        ..._attributes,
      ]);
      if (result.exitCode == 0) return (result.stdout as String).trimRight();
    } on ProcessException {
      // A minimal Linux desktop can run without libsecret-tools.
    }
    return null;
  }

  Future<void> write(String value) async {
    if (!Platform.isLinux) return _storage.write(key: 'account', value: value);
    final process = await Process.start('secret-tool', [
      'store',
      '--label=Шифр-связь',
      ..._attributes,
    ]);
    final output = Future.wait([
      process.stdout.drain<void>(),
      process.stderr.drain<void>(),
    ]);
    process.stdin.add(utf8.encode(value));
    await process.stdin.close();
    await output;
    if (await process.exitCode != 0) {
      throw StateError('Secret Service unavailable');
    }
  }

  Future<void> delete() async {
    if (!Platform.isLinux) return _storage.delete(key: 'account');
    final result = await Process.run('secret-tool', ['clear', ..._attributes]);
    if (result.exitCode != 0) throw StateError('Secret Service unavailable');
  }
}
