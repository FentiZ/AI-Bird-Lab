import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { apiRequest, apiUrl, photoUpload } from './src/client';

type Prediction = { species: string; confidence: number };
type Bird = { ukrainian_name: string; scientific_name: string; description_uk: string };
type Analysis = {
  id: number; imageName: string; predictedSpecies: string; confidence: number;
  status: 'queued' | 'done' | 'failed' | 'not_bird'; error: string; analysisDate: string;
  birdInfo: Bird | null; top3: Prediction[];
};
type Subscription = { wallet: string; active: boolean; expiresAt: number };

type Tab = 'photos' | 'history' | 'subscription';

export default function App() {
  const [url, setUrl] = useState('http://192.168.1.100:5080');
  const [token, setToken] = useState('');
  const [tab, setTab] = useState<Tab>('photos');
  const [image, setImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [history, setHistory] = useState<Analysis[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([SecureStore.getItemAsync('birdlab_url'), SecureStore.getItemAsync('birdlab_token')]).then(([savedUrl, savedToken]) => {
      if (savedUrl) setUrl(savedUrl);
      if (savedToken) setToken(savedToken);
    });
  }, []);

  async function request(path: string, method = 'GET', body?: FormData) {
    return apiRequest(url, token, path, method, body);
  }

  async function saveAndConnect() {
    setBusy(true);
    try {
      await SecureStore.setItemAsync('birdlab_url', url.trim());
      await SecureStore.setItemAsync('birdlab_token', token.trim());
      await refresh();
      Alert.alert('Готово', 'Підключено до AI Bird Lab');
    } catch (e) { Alert.alert('Помилка', String(e)); }
    setBusy(false);
  }

  async function refresh() {
    const [me, rows] = await Promise.all([request('/auth/me'), request('/analyses')]);
    setSubscription(me);
    setHistory(rows);
  }

  async function select(fromCamera: boolean) {
    try {
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (!result.canceled) {
        const asset = result.assets[0];
        photoUpload(asset); // Validate before the user can submit.
        setImage(asset);
      }
    } catch (e) { Alert.alert('Фото', String(e)); }
  }

  async function send() {
    if (!image) return;
    setBusy(true);
    try {
      const file = photoUpload(image);
      const data = new FormData();
      data.append('file', file as unknown as Blob);
      await request('/analyze', 'POST', data);
      Alert.alert('Успіх', 'Фото у черзі RabbitMQ. Результат з’явиться в історії.');
      setImage(null);
      setTab('history');
      await refresh();
    } catch (e) { Alert.alert('Помилка аналізу', String(e)); }
    setBusy(false);
  }

  async function remove(id: number) {
    try { await request(`/analyses/${id}`, 'DELETE'); await refresh(); }
    catch (e) { Alert.alert('Помилка', String(e)); }
  }

  const imageUri = (id: number) => apiUrl(url, `/analyses/${id}/image`);

  return <SafeAreaView style={styles.screen}>
    <StatusBar barStyle="light-content" />
    <View style={styles.header}><Text style={styles.logo}>🐦 AI Bird Lab</Text><Text style={styles.small}>Expo Go · React Native TS</Text></View>
    <View style={styles.tabs}>
      <TabButton text="Фото" selected={tab === 'photos'} onPress={() => setTab('photos')}/>
      <TabButton text="Історія" selected={tab === 'history'} onPress={() => { setTab('history'); if (token) refresh().catch(() => {}); }}/>
      <TabButton text="Підписка" selected={tab === 'subscription'} onPress={() => setTab('subscription')}/>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
      {busy && <ActivityIndicator size="large" color="#67dfaa" style={{ marginVertical: 15 }}/>} 
      {tab === 'subscription' && <View style={styles.card}>
        <Text style={styles.title}>Криптопідписка</Text>
        <Text style={styles.note}>Придбай тестову підписку через MetaMask у вебверсії, потім скопіюй токен з сайту й встав його тут.</Text>
        <Text style={styles.label}>Адреса API — LAN IP комп’ютера (НЕ localhost)</Text>
        <TextInput style={styles.input} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} placeholderTextColor="#74899b"/>
        <Text style={styles.label}>Bearer-токен із вебверсії</Text>
        <TextInput style={[styles.input, { minHeight: 75 }]} multiline value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} placeholderTextColor="#74899b"/>
        <Btn title="Зберегти та підключитися" onPress={saveAndConnect}/>
        <Text style={styles.note}>Оплату тестовими ETH виконай у браузері ПК за адресою http://localhost:5173. У Expo Go окремого гаманця немає.</Text>
        <Text style={styles.note}>{subscription ? `Гаманець: ${subscription.wallet}\nПідписка: ${subscription.active ? 'активна' : 'неактивна'}\nДо: ${subscription.expiresAt ? new Date(subscription.expiresAt * 1000).toLocaleString() : '—'}` : 'Стан ще не завантажено'}</Text>
      </View>}

      {tab === 'photos' && <View style={styles.card}>
        <Text style={styles.title}>Розпізнавання птаха</Text>
        <Text style={styles.note}>Тільки JPG/JPEG/PNG. AI спочатку перевіряє, чи є птах на фото. Потрібна активна криптопідписка.</Text>
        {image ? <Image source={{ uri: image.uri }} style={styles.preview}/> : <View style={styles.placeholder}><Text style={{ fontSize: 42 }}>🕊️</Text><Text style={styles.note}>Фото не вибрано</Text></View>}
        <Btn title="📷 Камера" secondary onPress={() => select(true)} />
        <Btn title="🖼️ Галерея" secondary onPress={() => select(false)} />
        <Btn title="Надіслати на AI" disabled={!image || busy || !subscription?.active} onPress={send}/>
        <Btn title="Оновити підписку" secondary onPress={() => refresh().catch(e => Alert.alert('Помилка', String(e)))}/>
      </View>}

      {tab === 'history' && <View>
        <View style={styles.row}><Text style={styles.title}>Історія ({history.length})</Text><TouchableOpacity onPress={() => refresh().catch(e => Alert.alert('Помилка', String(e)))}><Text style={styles.green}>Оновити ↻</Text></TouchableOpacity></View>
        {!history.length && <Text style={styles.note}>Даних немає. Перевір підключення на вкладці «Підписка».</Text>}
        {history.map(item => <View style={styles.card} key={item.id}>
          <Image source={{ uri: imageUri(item.id), headers: { Authorization: 'Bearer ' + token.trim() } }} style={styles.preview}/>
          <Text style={styles.small}>#{item.id} · {item.status}</Text>
          <Text style={styles.title}>{item.predictedSpecies || item.imageName}</Text>
          {(item.status === 'failed' || item.status === 'not_bird') && <Text style={styles.bad}>{item.error || 'На фото не виявлено птаха.'}</Text>}
          {item.status === 'done' && <><Text style={styles.green}>{item.confidence.toFixed(2)}% впевненість</Text>
            {item.top3.map(p => <Text style={styles.note} key={p.species}>{p.species} — {p.confidence.toFixed(1)}%</Text>)}
            <Text style={styles.note}>{item.birdInfo?.description_uk || 'Немає перевіреної інформації про цей вид'}</Text></>}
          <TouchableOpacity onPress={() => remove(item.id)}><Text style={styles.bad}>Видалити</Text></TouchableOpacity>
        </View>)}
      </View>}
    </ScrollView>
  </SafeAreaView>;
}

function TabButton({ text, selected, onPress }: { text: string; selected: boolean; onPress: () => void }) {
  return <TouchableOpacity onPress={onPress} style={[styles.tab, selected && styles.active]}><Text style={{ color: selected ? '#a1f3d0' : '#9badbd' }}>{text}</Text></TouchableOpacity>;
}
function Btn({ title, onPress, secondary, disabled }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <TouchableOpacity disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondary, disabled && { opacity: 0.35 }]}><Text style={{ fontWeight: '700', color: secondary ? '#b7d1d9' : '#063425' }}>{title}</Text></TouchableOpacity>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0c1420' }, header: { padding: 20, backgroundColor: '#111f2c' },
  logo: { color: 'white', fontSize: 23, fontWeight: '800' }, small: { color: '#92adbc', fontSize: 12, marginTop: 6 },
  tabs: { flexDirection: 'row', backgroundColor: '#111f2c', paddingHorizontal: 12, gap: 6 },
  tab: { paddingHorizontal: 15, paddingVertical: 14, borderRadius: 8 }, active: { backgroundColor: '#1d493b' },
  page: { padding: 16, paddingBottom: 50 }, card: { backgroundColor: '#172633', borderColor: '#334657', borderWidth: 1, borderRadius: 14, padding: 19, marginBottom: 16 },
  title: { color: 'white', fontSize: 19, fontWeight: '700', marginBottom: 12 }, label: { color: '#a9c0cc', marginBottom: 6, marginTop: 13 },
  note: { color: '#a4b4c4', lineHeight: 21, marginBottom: 12 }, input: { backgroundColor: '#0b1723', color: 'white', borderColor: '#3a4e5c', borderWidth: 1, borderRadius: 9, padding: 12, marginBottom: 12 },
  button: { backgroundColor: '#63dbac', borderRadius: 9, padding: 14, alignItems: 'center', marginTop: 9 }, secondary: { backgroundColor: '#2b4651' },
  preview: { width: '100%', height: 230, borderRadius: 10, backgroundColor: '#1b3440', marginBottom: 14 },
  placeholder: { height: 170, borderRadius: 10, borderWidth: 1, borderColor: '#39535a', alignItems: 'center', justifyContent: 'center', margin: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  green: { color: '#69e2b3', fontWeight: '700', marginBottom: 10 }, bad: { color: '#fa9eaf', marginTop: 10, fontWeight: '600' }
});
