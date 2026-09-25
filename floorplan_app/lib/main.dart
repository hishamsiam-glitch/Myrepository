import 'package:flutter/material.dart';

import 'screens/home_screen.dart';

void main() {
  runApp(const FloorPlanApp());
}

class FloorPlanApp extends StatelessWidget {
  const FloorPlanApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Floor Plan Tracer',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: const Color(0xFF2E6F73),
        useMaterial3: true,
        brightness: Brightness.light,
      ),
      darkTheme: ThemeData(
        colorSchemeSeed: const Color(0xFF2E6F73),
        useMaterial3: true,
        brightness: Brightness.dark,
      ),
      home: const HomeScreen(),
    );
  }
}
