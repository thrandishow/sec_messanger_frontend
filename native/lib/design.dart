import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

const blue = Color(0xff258ac1),
    ink = Color(0xff192e3b),
    muted = Color(0xff637986);
ThemeData appTheme() => ThemeData(
  useMaterial3: true,
  colorScheme: ColorScheme.fromSeed(seedColor: blue)
      .copyWith(primary: blue, surface: Colors.white, onSurface: ink),
  scaffoldBackgroundColor: Colors.white,
  appBarTheme: const AppBarTheme(
    backgroundColor: Colors.white,
    foregroundColor: ink,
    surfaceTintColor: Colors.transparent,
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: const Color(0xfff2f6f8),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: BorderSide.none,
    ),
  ),
);

class Avatar extends StatelessWidget {
  final String name;
  final double size;
  final bool group;
  const Avatar(this.name, {super.key, this.size = 44, this.group = false});
  @override
  Widget build(BuildContext context) {
    const palette = [
      Color(0xff5392cc),
      Color(0xff36a98b),
      Color(0xffad80c5),
      Color(0xffd18b50),
      Color(0xff6c94a3),
      Color(0xffc97891),
    ];
    final color = palette[name.runes.fold(0, (n, c) => n + c) % palette.length];
    final words = name
        .replaceAll('#', '')
        .trim()
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .toList();
    final initials = words
        .take(2)
        .map((w) => w.characters.first.toUpperCase())
        .join();
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color.lerp(color, Colors.white, .19)!, color],
        ),
      ),
      child: group
          ? Icon(
              name == 'Объявления'
                  ? Icons.campaign_outlined
                  : Icons.forum_outlined,
              color: Colors.white,
              size: size * .48,
            )
          : Text(
              initials,
              style: TextStyle(
                color: Colors.white,
                fontSize: size * .41,
                fontWeight: FontWeight.w600,
              ),
            ),
    );
  }
}

class ChatPaper extends StatelessWidget {
  final Widget child;
  const ChatPaper({super.key, required this.child});
  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [Color(0xffd8eae2), Color(0xffe7eee0), Color(0xffd0e7e4)],
      ),
    ),
    child: ClipRect(
      child: CustomPaint(painter: const _PaperPattern(), child: child),
    ),
  );
}

// A repeating line drawing in the conversation background, kept faint behind messages.
class _PaperPattern extends CustomPainter {
  const _PaperPattern();
  @override
  void paint(Canvas c, Size s) {
    final p = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.35
      ..strokeJoin = StrokeJoin.round
      ..strokeCap = StrokeCap.round
      ..color = const Color(0x22759686);
    for (int y = 0; y < s.height / 78 + 1; y++) {
      for (int x = -1; x < s.width / 87 + 1; x++) {
        c.save();
        c.translate(x * 87 + (y.isOdd ? 40 : 11), y * 78 + 19);
        c.rotate((x + y).isEven ? -.18 : .22);
        switch ((x + 2 * y) % 4) {
          case 0:
            c.drawPath(
              Path()
                ..moveTo(0, 7)
                ..lineTo(23, 0)
                ..lineTo(16, 21)
                ..lineTo(10, 12)
                ..close()
                ..moveTo(10, 12)
                ..lineTo(23, 0),
              p,
            );
          case 1:
            c.drawPath(
              Path()
                ..moveTo(4, 2)
                ..quadraticBezierTo(0, 2, 0, 8)
                ..lineTo(0, 14)
                ..quadraticBezierTo(0, 19, 6, 19)
                ..lineTo(7, 24)
                ..lineTo(13, 19)
                ..lineTo(19, 19)
                ..quadraticBezierTo(25, 19, 25, 12)
                ..lineTo(25, 8)
                ..quadraticBezierTo(25, 2, 19, 2)
                ..close(),
              p,
            );
            c.drawLine(const Offset(6, 8), const Offset(19, 8), p);
          case 2:
            c.drawPath(
              Path()
                ..moveTo(11, 0)
                ..lineTo(14, 7)
                ..lineTo(22, 10)
                ..lineTo(14, 13)
                ..lineTo(11, 21)
                ..lineTo(8, 13)
                ..lineTo(1, 10)
                ..lineTo(8, 7)
                ..close(),
              p,
            );
          case 3:
            c.drawArc(
              const Rect.fromLTWH(0, 0, 20, 20),
              .15,
              math.pi * 1.6,
              false,
              p,
            );
            c.drawCircle(const Offset(11, 10), 4, p);
            c.drawLine(const Offset(19, 12), const Offset(22, 16), p);
        }
        c.restore();
      }
    }
  }

  @override
  bool shouldRepaint(CustomPainter oldDelegate) => false;
}

String clockLabel(dynamic iso) {
  final t = DateTime.tryParse(iso?.toString() ?? '')?.toLocal();
  if (t == null) return '';
  return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
}

String dateLabel(dynamic iso) {
  final t = DateTime.tryParse(iso?.toString() ?? '')?.toLocal();
  if (t == null) return '';
  final now = DateTime.now();
  if (DateUtils.isSameDay(now, t)) return 'Сегодня';
  if (DateUtils.isSameDay(now.subtract(const Duration(days: 1)), t)) {
    return 'Вчера';
  }
  return '${t.day} ${const ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][t.month - 1]} ${t.year}';
}

String fileSize(int n) => n < 1048576
    ? '${(n / 1024).ceil()} КиБ'
    : '${(n / 1048576).toStringAsFixed(1)} МиБ';
