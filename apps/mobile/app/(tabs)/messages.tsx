import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { api, ApiError } from '../../lib/api';
import { getOpsSocket } from '../../lib/ops';
import { useAuth } from '../../lib/auth-context';

interface MessageRow {
  id: string;
  content: string;
  createdAt: string;
  from: { id: string; firstName: string; lastName: string; badgeNumber?: string; role: string };
  to?: { id: string; firstName: string; lastName: string } | null;
}

export default function MessagesScreen() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<MessageRow>>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<MessageRow[]>('/ops/messages');
      setMessages(data.reverse());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Chargement impossible');
    }
  }, []);

  useEffect(() => {
    refresh();
    let cleanup: (() => void) | undefined;
    getOpsSocket().then((socket) => {
      const onNew = () => refresh();
      socket.on('message.new', onNew);
      cleanup = () => socket.off('message.new', onNew);
    });
    return () => cleanup?.();
  }, [refresh]);

  async function send() {
    if (!draft.trim()) return;
    const content = draft;
    setDraft('');
    try {
      await api.post('/ops/messages', { content });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible');
      setDraft(content);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
      keyboardVerticalOffset={90}
    >
      <Text style={styles.title}>Centre de commandement</Text>
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          const mine = item.from.id === user?.id;
          return (
            <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
              {!mine && (
                <Text style={styles.author}>
                  {item.from.firstName} {item.from.lastName}
                  {item.from.badgeNumber ? ` · ${item.from.badgeNumber}` : ''}
                </Text>
              )}
              <Text style={mine ? styles.textMine : styles.textOther}>{item.content}</Text>
              <Text style={[styles.time, mine && { color: '#c7d5f5' }]}>
                {new Date(item.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={styles.empty}>Aucun message sur le canal général.</Text>}
        contentContainerStyle={{ paddingBottom: 12 }}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Message au centre…"
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={send}>
          <Text style={styles.sendText}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#0f1f4a', marginBottom: 12 },
  error: { color: '#dc2626', fontSize: 12, marginBottom: 8 },
  bubble: { maxWidth: '82%', borderRadius: 14, padding: 10, marginBottom: 8 },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: '#2f5fdb' },
  bubbleOther: { alignSelf: 'flex-start', backgroundColor: 'white', borderWidth: 1, borderColor: '#e2e8f0' },
  author: { fontSize: 11, fontWeight: '700', color: '#2f5fdb', marginBottom: 2 },
  textMine: { color: 'white', fontSize: 14 },
  textOther: { color: '#0f172a', fontSize: 14 },
  time: { fontSize: 10, color: '#94a3b8', marginTop: 3, alignSelf: 'flex-end' },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 30 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', paddingTop: 8 },
  input: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#2f5fdb',
    borderRadius: 12,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: 'white', fontSize: 18 },
});
