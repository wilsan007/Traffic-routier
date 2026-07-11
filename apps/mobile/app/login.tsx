import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { router } from 'expo-router';
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
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof Error && err.message === 'ABORT_TIMEOUT') {
        setError('Serveur injoignable. Utilisez le mode démo pour tester sans serveur.');
      } else {
        setError('Connexion impossible. Utilisez le mode démo pour tester sans serveur.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>TrafficGuard</Text>
        <Text style={styles.subtitle}>Application terrain — agents de police</Text>

        {/* Mode démo — mis en évidence EN HAUT */}
        <TouchableOpacity
          style={styles.demoButton}
          onPress={() => router.push('/demo')}
          activeOpacity={0.7}
        >
          <Text style={styles.demoButtonText}>🧪 Mode démo — Reconnaissance de plaques</Text>
          <Text style={styles.demoSubtext}>Testez sans serveur, directement avec la caméra</Text>
        </TouchableOpacity>

        {/* Séparateur */}
        <View style={styles.separator}>
          <View style={styles.separatorLine} />
          <Text style={styles.separatorText}>Connexion serveur (optionnel)</Text>
          <View style={styles.separatorLine} />
        </View>

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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1f4a' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: 'bold', color: 'white', marginBottom: 4, textAlign: 'center' },
  subtitle: { color: '#d9e6ff', marginBottom: 24, textAlign: 'center' },

  // Mode démo — bouton vert prominent
  demoButton: {
    backgroundColor: '#22c55e',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 24,
  },
  demoButtonText: { color: 'white', fontWeight: 'bold', fontSize: 17 },
  demoSubtext: { color: '#dcfce7', fontSize: 13, marginTop: 4 },

  // Séparateur
  separator: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  separatorLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.2)' },
  separatorText: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginHorizontal: 8 },

  input: {
    backgroundColor: 'white',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  button: { backgroundColor: '#2f5fdb', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
  error: { color: '#fca5a5', marginBottom: 8, textAlign: 'center' },
  hint: { color: '#93a5d1', fontSize: 12, marginTop: 16, textAlign: 'center' },
});
