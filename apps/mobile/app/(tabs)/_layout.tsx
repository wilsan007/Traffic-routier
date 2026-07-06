import { useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { Text } from 'react-native';
import { useAuth } from '../../lib/auth-context';

export default function TabsLayout() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user]);

  if (loading || !user) return null;

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#2f5fdb' }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Accueil', tabBarIcon: () => <Text>🏠</Text> }}
      />
      <Tabs.Screen
        name="capture"
        options={{ title: 'Scanner', tabBarIcon: () => <Text>📷</Text> }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: 'Recherche', tabBarIcon: () => <Text>🔍</Text> }}
      />
      <Tabs.Screen
        name="alerts"
        options={{ title: 'Alertes', tabBarIcon: () => <Text>🚨</Text> }}
      />
    </Tabs>
  );
}
