#!/usr/bin/env dart
library bakery;

import 'dart:async';
import 'dart:math' as math show max, min;
import 'package:oven/oven.dart' hide Broken;
export 'src/loaf.dart' show Loaf;
part 'bakery.g.dart';

/// A small oven timer. This doc comment says class and "string" but stays a comment.
// One line comment: void final if 'quotes'
/* A block comment /* with a nested one */ that is still a comment */

const maxLoaves = 1000;
const mask = 0xFF;
const ratio = 1.5e-3;
const big = 2E10;
const half = .5;
const spaced = 1_000;
const flag = true;

typedef Recipe = Map<String, List<int>>;

enum Heat { low, medium, high }

sealed class Dough {
  const Dough();
}

base class Rye extends Dough {
  final int hours;
  const Rye(this.hours);
}

interface class Starter {}

abstract interface class Baked {
  String get name;
  set heat(int value);
}

mixin Slicer on Baked {
  int slices() => 8;
}

mixin class Warmer {}

extension LoafText on String {
  String shout() => toUpperCase();
}

class Loaf extends Dough with Slicer implements Baked {
  static int _count = 0;
  final String _name;
  late final int weight;
  int? _heat;
  List<Map<String, int>> history = [];

  Loaf(this._name, {required this.weight, int heat = 200}) : _heat = heat {
    _count++;
  }

  factory Loaf.plain() => Loaf('plain', weight: 500);

  @override
  String get name => _name;

  @override
  set heat(int value) => _heat = value;

  @override
  bool operator ==(Object other) => other is Loaf && other._name == _name;

  @override
  int get hashCode => _name.hashCode;

  @Deprecated('Use bake instead')
  void cook() {}

  @pragma('vm:prefer-inline')
  int total(List<int> parts) => parts.fold(0, (a, b) => a + b);

  Future<String> bake() async {
    await Future.delayed(const Duration(seconds: 1));
    return 'baked $name';
  }

  Stream<int> counter() async* {
    for (var i = 0; i < 3; i++) {
      yield i;
    }
  }

  Iterable<int> evens() sync* {
    yield* [2, 4, 6];
  }
}

class _Counter<T extends num> {
  T? last;
}

String describe(Loaf? loaf, Map<String, int>? extras) {
  final name = loaf?.name ?? 'none';
  var count = extras?['count'];
  count ??= 0;
  final list = [1, 2, ...?extras?.values, ...[3, 4]];
  final buffer = StringBuffer()
    ..write(name)
    ..write(' x ')
    ..writeln(count);
  final sym = #bake;
  final qual = #dart.core.int;
  final op = #+;
  print(sym);
  print(qual);
  print(op);
  print(list);
  return buffer.toString();
}

String quotes(String kind, int n) {
  var single = 'It\'s $kind with ${n + 1} slices';
  var quoted = "say \"hi\" to $kind";
  var nested = 'a ${n > 1 ? 'many ${kind.length}' : "one"} b';
  var braces = 'map: ${ {'a': 1}.length } end';
  var escaped = 'cost: \$5 and \${not code}';
  var raw = r'raw $kind \n ${nothing}';
  var rawDouble = r"also raw $kind \t";
  var multi = '''
Today's bake: $kind
  a "quote" and 'quotes' stay string text
  sum is ${n + n}
''';
  var multiDouble = """
Heat: ${Heat.high.name}
""";
  var rawMulti = r'''
no $interpolation here \n
''';
  return single + quoted + nested + braces + escaped + raw + rawDouble + multi + multiDouble + rawMulti;
}

String grade(Object value) {
  return switch (value) {
    int n when n > 100 => 'big',
    int() => 'small',
    String s when s.isEmpty => 'empty',
    _ => 'other',
  };
}

void guarded() {
  try {
    throw FormatException('bad');
  } on FormatException catch (e) {
    print(e);
  } on Exception {
    rethrow;
  } finally {
    print('done');
  }
}

void main() async {
  final loaf = Loaf('rye', weight: 800);
  print(await loaf.bake());
  print(describe(loaf, {'count': 2}));
  var get = 1;
  var base = 2;
  var late = 3;
  var async = 4;
  var show = get + base + late + async;
  print(show);
  print(math.max(1, 2));
  print(quotes('sourdough', 3));
}
