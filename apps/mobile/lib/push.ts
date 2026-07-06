import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Enregistre le jeton push Expo auprès de l'API (best-effort : indisponible
// dans Expo Go depuis le SDK 53, fonctionne en development build).
export async function registerPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const res = await Notifications.requestPermissionsAsync();
      status = res.status;
    }
    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Alertes TrafficGuard',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
      });
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    await api.post('/ops/push-token', { token });
  } catch {
    // Expo Go / simulateur : pas de push distant, on ignore silencieusement
  }
}
