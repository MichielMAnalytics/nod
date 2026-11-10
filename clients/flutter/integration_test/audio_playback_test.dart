import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path_provider/path_provider.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'native player opens a synthetic WAV and supports playback pause and seek',
    (tester) async {
      final root = await (await getTemporaryDirectory()).createTemp(
        'nod-native-audio-test-',
      );
      final player = AudioPlayer();
      try {
        const rate = 16000;
        const samples = rate * 2;
        final bytes = ByteData(44 + samples * 2);
        void ascii(int offset, String text) {
          for (var index = 0; index < text.length; index++) {
            bytes.setUint8(offset + index, text.codeUnitAt(index));
          }
        }

        ascii(0, 'RIFF');
        bytes.setUint32(4, bytes.lengthInBytes - 8, Endian.little);
        ascii(8, 'WAVE');
        ascii(12, 'fmt ');
        bytes.setUint32(16, 16, Endian.little);
        bytes.setUint16(20, 1, Endian.little);
        bytes.setUint16(22, 1, Endian.little);
        bytes.setUint32(24, rate, Endian.little);
        bytes.setUint32(28, rate * 2, Endian.little);
        bytes.setUint16(32, 2, Endian.little);
        bytes.setUint16(34, 16, Endian.little);
        ascii(36, 'data');
        bytes.setUint32(40, samples * 2, Endian.little);
        for (var index = 0; index < samples; index++) {
          bytes.setInt16(
            44 + index * 2,
            (math.sin(index * 2 * math.pi * 440 / rate) * 1000).round(),
            Endian.little,
          );
        }
        final file = await File('${root.path}/synthetic.wav')
            .writeAsBytes(bytes.buffer.asUint8List());
        final duration = await player.setFilePath(file.path);
        expect(duration!.inMilliseconds, closeTo(2000, 100));
        await player.setVolume(0);
        final finished = player.play();
        await Future<void>.delayed(const Duration(milliseconds: 200));
        expect(player.playing, true);
        await player.pause();
        await finished;
        expect(player.playing, false);
        await player.seek(const Duration(seconds: 1));
        expect(player.position.inMilliseconds, closeTo(1000, 100));
      } finally {
        await player.dispose();
        await root.delete(recursive: true);
      }
    },
  );
}
