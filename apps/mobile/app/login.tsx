import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useAuth } from '../lib/auth-context';
import { ApiError } from '../lib/api';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('agent@trafficguard.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connexion impossible');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <Text style={styles.title}>TrafficGuard</Text>
      <Text style={styles.subtitle}>Application terrain — agents de police</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Mot de passe"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Connexion…' : 'Se connecter'}</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>Démo : agent@trafficguard.local / Officer123!</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0f1f4a' },
  title: { fontSize: 32, fontWeight: 'bold', color: 'white', marginBottom: 4 },
  subtitle: { color: '#d9e6ff', marginBottom: 32 },
  input: {
    backgroundColor: 'white',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  button: { backgroundColor: '#2f5fdb', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
  error: { color: '#fca5a5', marginBottom: 8 },
  hint: { color: '#93a5d1', fontSize: 12, marginTop: 20, textAlign: 'center' },
});
