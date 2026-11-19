import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goreecloud_teams/main.dart';

void main() {
  testWidgets('Server connection starts with a user-controlled HTTPS endpoint',
      (tester) async {
    await tester.pumpWidget(const GoreeCloudTeamsApp());
    expect(find.text('Your team. Your space.'), findsOneWidget);
    expect(find.text('Connect'), findsOneWidget);
    expect(find.byIcon(Icons.hub_outlined), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
  });
}
