import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:goreecloud_teams/main.dart';
import 'package:goreecloud_teams/generated/gc_ui_tokens.g.dart';

void main() {
  test('light native theme consumes GoreeCloud UI canonical roles', () {
    final theme = GcColors.theme(Brightness.light);
    expect(theme.useMaterial3, isTrue);
    expect(theme.scaffoldBackgroundColor, GcUiTokenColors.lightCanvas);
    expect(theme.colorScheme.primary, GcUiTokenColors.lightBrand);
    expect(theme.colorScheme.onPrimary, GcUiTokenColors.lightOnBrand);
    expect(theme.colorScheme.surface, GcUiTokenColors.lightSurface);
    expect(theme.colorScheme.onSurface, GcUiTokenColors.lightText);
    expect(theme.colorScheme.outline, GcUiTokenColors.lightOutline);
    expect(theme.colorScheme.error, GcUiTokenColors.lightError);
    expect(theme.colorScheme.secondaryContainer,
        GcUiTokenColors.lightBrandContainer);
    expect(theme.colorScheme.onSecondaryContainer,
        GcUiTokenColors.lightOnBrandContainer);
  });

  test('dark native theme consumes GoreeCloud UI canonical roles', () {
    final theme = GcColors.theme(Brightness.dark);
    expect(theme.useMaterial3, isTrue);
    expect(theme.scaffoldBackgroundColor, GcUiTokenColors.darkCanvas);
    expect(theme.colorScheme.primary, GcUiTokenColors.darkBrand);
    expect(theme.colorScheme.onPrimary, GcUiTokenColors.darkOnBrand);
    expect(theme.colorScheme.surface, GcUiTokenColors.darkSurface);
    expect(theme.colorScheme.onSurface, GcUiTokenColors.darkText);
    expect(theme.colorScheme.outline, GcUiTokenColors.darkOutline);
    expect(theme.colorScheme.error, GcUiTokenColors.darkError);
    expect(theme.colorScheme.secondaryContainer,
        GcUiTokenColors.darkBrandContainer);
    expect(theme.colorScheme.onSecondaryContainer,
        GcUiTokenColors.darkOnBrandContainer);
  });
}
