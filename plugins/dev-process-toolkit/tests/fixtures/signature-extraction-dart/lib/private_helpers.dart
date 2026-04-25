/// Greet the world.
String hello() => _greet('hi');

String _greet(String prefix) => '$prefix world';

class _PrivateThing {
  void doNothing() {}
}
