import 'package:flutter_test/flutter_test.dart';
import 'package:app_smart/main.dart';

void main() {
  testWidgets('App smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const AppSmartApp());
    await tester.pump();
  });
}
