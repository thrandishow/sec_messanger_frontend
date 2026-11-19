import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';

import 'api.dart';

Future<(String, Uint8List)?> pickDocument({
  int maximum = fileLimit,
  String title = 'Выбрать документ',
}) async {
  final file = await FilePicker.pickFile(dialogTitle: title);
  if (file == null) return null;
  final size = await file.length();
  if (size != null && size > maximum) {
    throw const ClientError('Файл слишком большой.');
  }
  final bytes = BytesBuilder(copy: false);
  await for (final chunk in file.readAsByteStream()) {
    if (bytes.length + chunk.length > maximum) {
      throw const ClientError('Файл слишком большой.');
    }
    bytes.add(chunk);
  }
  return (file.name, bytes.takeBytes());
}

Future<void> saveDocument(ChatApi api, Json file) async {
  final bytes = await api.download(file['id']);
  await FilePicker.saveFile(
    dialogTitle: 'Сохранить документ',
    fileName: file['name'],
    bytes: bytes,
  );
}
