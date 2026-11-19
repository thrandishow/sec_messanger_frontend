import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shifr_client/api.dart';
import 'package:shifr_client/chat.dart';
import 'package:shifr_client/design.dart';
import 'package:shifr_client/messenger.dart';

class FixtureApi extends ChatApi {
  FixtureApi() : super(Uri.parse('https://127.0.0.1:8443'));
  @override
  Future<Json> get(String path, [Map<String, String>? query]) async => {
    'messages': <Json>[],
    'nextBefore': null,
  };
}

void main() {
  test(
    'normalizes a LAN endpoint and rejects plaintext and non-LAN addresses',
    () {
      expect(serverAddress('192.168.1.10').origin, 'https://192.168.1.10:8443');
      expect(serverAddress('192.168.1.10:443').origin, 'https://192.168.1.10');
      expect(
        serverAddress('https://192.168.1.11:8443/').origin,
        'https://192.168.1.11:8443',
      );
      for (final url in [
        'http://192.168.1.1',
        'https://example.org',
        'https://8.8.8.8',
        'https://name@192.168.1.1',
        'https://192.168.1.2/private',
      ]) {
        expect(() => serverAddress(url), throwsA(isA<ClientError>()));
      }
    },
  );
  test('history and live copies merge by server ID in chronological order', () {
    final t = Thread('#general', 'Общий чат');
    expect(t.merge({'id': 4, 'text': 'Привет'}), isTrue);
    expect(t.merge({'id': 1, 'text': 'Начало'}), isTrue);
    expect(t.merge({'id': 4, 'text': 'Привет'}), isFalse);
    expect(t.messages.map((m) => m['id']), [1, 4]);
    expect(t.latest?['id'], 4);
  });
  for (final size in [const Size(390, 844), const Size(1280, 800)]) {
    testWidgets(
      'chat navigation and server messages at ${size.width.toInt()}px',
      (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final chat = Chat(FixtureApi(), {
          'id': '01',
          'nickname': 'alice',
          'role': 'member',
        }, () {});
        addTearDown(chat.dispose);
        final t = chat.threads['#general'] = Thread('#general', 'Общий чат');
        t.merge({
          'id': 1,
          'from': 'bob',
          'target': '#general',
          'text': 'Доброе утро',
          'time': '2026-11-19T09:00:00Z',
        });
        chat.threads['#announcements'] = Thread('#announcements', 'Объявления');
        await tester.pumpWidget(
          MaterialApp(
            theme: appTheme(),
            home: Messenger(chat: chat, logout: () async {}),
          ),
        );
        expect(find.text('Чаты'), findsOneWidget);
        await tester.tap(find.text('Общий чат'));
        await tester.pumpAndSettle();
        expect(find.text('Доброе утро'), findsOneWidget);
        expect(find.byTooltip('Отправить'), findsOneWidget);
        if (size.width < 760) {
          expect(find.text('Чаты'), findsNothing);
          await tester.tap(find.byTooltip('Назад к чатам'));
          await tester.pumpAndSettle();
        }
        await tester.tap(find.text('Объявления'));
        await tester.pumpAndSettle();
        expect(find.byTooltip('Отправить'), findsNothing);
        expect(
          find.text('Публикуют модераторы и администраторы'),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }
}
