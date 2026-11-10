import 'connection_state.dart';
import 'nod_models.dart';

abstract interface class NodRepository {
  Stream<NodConnectionState> get connectionStates;

  Stream<NodEvent> get events;

  Future<void> connect(NodConnectionConfig config);

  Future<void> disconnect();

  Future<NodState> loadState();

  Future<NodHistory> loadHistory({String? cursor});

  Future<void> sendText(String text, {required String clientMessageId});

  Future<void> stop();
}
