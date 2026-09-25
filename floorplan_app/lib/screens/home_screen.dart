import 'package:flutter/material.dart';

import '../model/plan.dart';
import '../services/project_store.dart';
import 'plan_editor_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<FloorPlan>? _plans;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final plans = await ProjectStore.instance.listPlans();
    if (mounted) setState(() => _plans = plans);
  }

  Future<void> _newPlan({required bool camera}) async {
    final plans = _plans ?? const <FloorPlan>[];
    final plan = FloorPlan.create('Plan ${plans.length + 1}');
    await ProjectStore.instance.save(plan);
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => PlanEditorScreen(plan: plan, openArOnStart: camera)),
    );
    await _reload();
  }

  Future<void> _open(FloorPlan plan) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => PlanEditorScreen(plan: plan)));
    await _reload();
  }

  Future<void> _delete(FloorPlan plan) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete "${plan.name}"?'),
        content: const Text('This removes the plan and its photos from this phone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    await ProjectStore.instance.delete(plan);
    await _reload();
  }

  @override
  Widget build(BuildContext context) {
    final plans = _plans;
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Floor Plan Tracer')),
      body: plans == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _StartCard(
                  icon: Icons.camera_alt,
                  title: 'Trace with camera',
                  subtitle: 'Walk the room and mark floor corners, doors and windows in AR. Distances are measured for you.',
                  color: theme.colorScheme.primaryContainer,
                  onTap: () => _newPlan(camera: true),
                ),
                const SizedBox(height: 10),
                _StartCard(
                  icon: Icons.draw,
                  title: 'Draw or trace a photo',
                  subtitle: 'Draw walls on a grid, or photograph a paper plan, set its scale and trace over it.',
                  color: theme.colorScheme.secondaryContainer,
                  onTap: () => _newPlan(camera: false),
                ),
                const SizedBox(height: 24),
                if (plans.isNotEmpty) Text('Your plans', style: theme.textTheme.titleMedium),
                for (final p in plans)
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.home_work_outlined),
                      title: Text(p.name),
                      subtitle: Text(
                        '${p.walls.length} walls - ${fmtMeters(p.totalWallLength, decimals: 1)} total - '
                        '${p.updated.day}/${p.updated.month}/${p.updated.year}',
                      ),
                      trailing: IconButton(
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () => _delete(p),
                      ),
                      onTap: () => _open(p),
                    ),
                  ),
                if (plans.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 24),
                    child: Text(
                      'No saved plans yet. Start with one of the options above.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium,
                    ),
                  ),
              ],
            ),
    );
  }
}

class _StartCard extends StatelessWidget {
  const _StartCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: color,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(icon, size: 40),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 4),
                    Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}
