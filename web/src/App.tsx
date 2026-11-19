import { useEffect, useState } from 'react';
import { api, clearToken, getToken, type Analysis, type Bird, type ContractInfo, type Stats, type Subscription } from './api';
import { signIn, buySubscription } from './wallet';
import './style.css';
import { validatePhotoFile } from './photo';

function AuthImage({ id }: { id: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    let current = '';
    api.image(id).then(blob => {
      if (active) { current = URL.createObjectURL(blob); setUrl(current); }
    }).catch(() => {});
    return () => { active = false; if (current) URL.revokeObjectURL(current); };
  }, [id]);
  return url ? <img className="thumb" src={url} alt="Bird photo" /> : <div className="thumb blank">🕊️</div>;
}

const money = (n: string) => (Number(n) / 1e18).toString() + ' test ETH';
const date = (n: number) => n ? new Date(n * 1000).toLocaleString('uk-UA') : '—';

function Details({ bird }: { bird: Bird | null }) {
  if (!bird) return <small className="muted">Цього виду немає в локальному довіднику. Факти не генеруються.</small>;
  return <div className="details"><strong>{bird.ukrainian_name}</strong> · <i>{bird.scientific_name}</i>
    <p>{bird.description_uk}</p><small>Родина: {bird.family} · Живлення: {bird.diet_uk} · Статус: {bird.conservation || 'невідомо'}</small>
    <p><a href={bird.source_url} target="_blank" rel="noreferrer">Перевірене джерело</a></p>
  </div>;
}

export default function App() {
  const [tab, setTab] = useState<'analyze' | 'history' | 'stats' | 'catalog'>('analyze');
  const [wallet, setWallet] = useState<Subscription | null>(null);
  const [chain, setChain] = useState<ContractInfo | null>(null);
  const [rows, setRows] = useState<Analysis[]>([]);
  const [birds, setBirds] = useState<Bird[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [search, setSearch] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    const [c, b] = await Promise.all([api.chain(), api.birds()]);
    setChain(c); setBirds(b);
    if (getToken()) {
      try {
        const user = await api.me();
        setWallet(user);
        const [history, summary] = await Promise.all([api.analyses(), api.stats()]);
        setRows(history); setStats(summary);
      } catch { setWallet(null); }
    }
  }
  useEffect(() => { load().catch(e => setMessage(String(e))); }, []);
  useEffect(() => {
    if (!wallet) return;
    const id = window.setInterval(() => {
      Promise.all([api.analyses(search), api.stats(), api.me()]).then(([r, s, w]) => {
        setRows(r); setStats(s); setWallet(w);
      }).catch(() => {});
    }, 3500);
    return () => window.clearInterval(id);
  }, [wallet?.wallet, search]);

  async function connect() {
    setBusy(true); setMessage('');
    try {
      await signIn();
      await load();
      setMessage('Гаманець підключено.');
    } catch (e) { setMessage(String(e)); }
    setBusy(false);
  }
  async function pay() {
    setBusy(true); setMessage('Підтвердіть платіж тестовими ETH у MetaMask.');
    try {
      await buySubscription();
      const status = await api.me();
      setWallet(status);
      setMessage('Підписка активна!');
    } catch (e) { setMessage(String(e)); }
    setBusy(false);
  }
  async function send() {
    if (!files.length) return;
    const errorsBefore = files.map(f => validatePhotoFile(f)).filter(Boolean);
    if (errorsBefore.length) { setMessage(errorsBefore.join(' ')); return; }
    setBusy(true); setMessage('Завдання відправляються до RabbitMQ…');
    let count = 0;
    const errors: string[] = [];
    for (const file of files) {
      try { await api.analyze(file); count++; }
      catch (e) { errors.push(`${file.name}: ${String(e)}`); }
    }
    setFiles([]);
    const [all, summary] = await Promise.all([api.analyses(), api.stats()]);
    setRows(all); setStats(summary);
    setMessage(`У черзі ${count} з ${files.length} фото. ${errors.length ? 'Помилки: ' + errors.join('; ') : 'Очікуйте результати AI-воркера.'}`);
    setBusy(false);
    setTab('history');
  }
  async function remove(id: number) {
    if (!window.confirm('Видалити аналіз?')) return;
    try { await api.delete(id); setRows(await api.analyses(search)); }
    catch (e) { setMessage(String(e)); }
  }
  async function find(value: string) {
    setSearch(value);
    if (getToken()) api.analyses(value).then(setRows).catch(() => {});
  }
  function selectFiles(selected: File[]) {
    const valid = selected.filter(f => !validatePhotoFile(f));
    const invalid = selected.filter(f => !!validatePhotoFile(f));
    setFiles(valid);
    if (invalid.length) setMessage('Відхилено: ' + invalid.map(f => `${f.name}: ${validatePhotoFile(f)}`).join('; '));
    else setMessage('');
  }
  function disconnect() { clearToken(); setWallet(null); setRows([]); setStats(null); setMessage('Сеанс завершено.'); }

  return <div className="app">
    <aside className="sidebar">
      <div className="logo"><span>🐦</span><div><strong>AI Bird Lab</strong><small>Crypto + AI + RabbitMQ</small></div></div>
      <nav>
        {([['analyze','🔍 Аналіз'],['history','🕘 Історія'],['stats','📊 Статистика'],['catalog','📚 Птахи']] as const).map(([id,label]) =>
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      <div className="sidebar-foot">Python AI Worker · ASP.NET Core · SQL Server<br/>Solidity · Hardhat · Expo Go</div>
    </aside>
    <main className="content">
      <header><strong>Bird Lab / Dashboard</strong><span>Навчальний проєкт · тільки тестова криптовалюта</span></header>
      <div className="page">
        <div className="heading"><div><div className="tag">SMART CONTRACT SUBSCRIPTION</div><h1>Досліджуй птахів за допомогою AI</h1><p>Результати обробляються асинхронно через RabbitMQ, а доступ перевіряється у блокчейні.</p></div></div>
        {message && <div className="notice" role="status">{message}<button onClick={() => setMessage('')}>×</button></div>}
        <section className="panel subscription">
          <div><div className="tag">ПІДПИСКА</div>
            <h2>{wallet ? `${wallet.wallet.slice(0, 7)}…${wallet.wallet.slice(-5)}` : 'Підключіть MetaMask'}</h2>
            <p>{wallet ? (wallet.active ? `✅ Активна до ${date(wallet.expiresAt)}` : '⛔ Немає активної підписки') : 'Підпис входу не витрачає ETH.'}</p>
            <small>Мережа Hardhat (31337) · контракт: {chain ? `${chain.address.slice(0, 12)}…` : 'завантаження…'}</small>
          </div>
          <div className="actions">
            {!wallet && <button className="primary" disabled={busy} onClick={connect}>Підключити гаманець</button>}
            {wallet && <><button className="primary" disabled={busy} onClick={pay}>Оплатити {chain ? money(chain.priceWei) : 'підписку'} · 30 днів</button>
              <button onClick={() => navigator.clipboard.writeText(getToken()).then(() => setMessage('Токен для Expo Go скопійовано. Не передавайте його іншим!'))}>Скопіювати токен для Expo Go</button>
              <button onClick={disconnect}>Вийти</button></>}
          </div>
        </section>

        {tab === 'analyze' && <section className="panel"><h2>🔍 Фотоаналіз</h2><p className="muted">Підтримуються JPG, JPEG та PNG. До 10 МБ на фото. GIF, відео й документи не приймаються. Якщо птаха немає, AI повідомить про це.</p>
          <label className="file-box">📷 <b>Обрати фото</b><small>{files.length ? files.map(f => f.name).join(', ') : 'Виберіть одне або кілька фото'}</small>
            <input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" multiple onChange={e => selectFiles(Array.from(e.target.files || []))}/></label>
          <button className="primary" disabled={busy || !wallet?.active || !files.length} onClick={send}>Надіслати на AI-аналіз</button>
          {!wallet?.active && <p className="muted">Для аналізу потрібна активна підписка. Після оплати натисніть «Оновити статус» або підключіть гаманець знову.</p>}
          {wallet && <button className="secondary" onClick={() => api.me().then(setWallet).catch(e => setMessage(String(e)))}>Оновити статус</button>}
        </section>}

        {tab === 'history' && <section className="panel"><div className="section-heading"><h2>🕘 Історія ({rows.length})</h2><button onClick={() => api.export().catch(e => setMessage(String(e)))}>Експорт CSV</button></div>
          <input className="search" placeholder="Пошук за назвою виду або фото" value={search} onChange={e => find(e.target.value)}/>
          {!wallet && <p className="muted">Спочатку увійдіть через MetaMask.</p>}
          {wallet && !rows.length && <p className="muted">Аналізів поки немає.</p>}
          {rows.map(row => <article className="result" key={row.id}><AuthImage id={row.id}/><div className="result-body">
            <div className="tag">#{row.id} · {row.status === 'queued' ? '🕓 У черзі' : row.status === 'failed' ? '❌ Помилка' : row.status === 'not_bird' ? '🚫 Це не птах' : '✅ Готово'}</div>
            <h3>{row.predictedSpecies || row.imageName}</h3><small className="muted">{new Date(row.analysisDate).toLocaleString('uk-UA')}</small>
            {(row.status === 'failed' || row.status === 'not_bird') && <p className="bad">{row.error || 'На фото не виявлено птаха.'}</p>}
            {row.status === 'done' && <><p className="accent">Упевненість: {row.confidence.toFixed(2)}%</p>
              <div className="top3">{row.top3.map(x => <div key={x.species}><span>{x.species}</span><strong>{x.confidence.toFixed(1)}%</strong></div>)}</div>
              <Details bird={row.birdInfo}/></>}
          </div><button className="danger" onClick={() => remove(row.id)}>Видалити</button></article>)}
        </section>}

        {tab === 'stats' && <><div className="metrics"><section className="panel"><span>Завершені аналізи</span><strong>{stats?.total ?? 0}</strong></section><section className="panel"><span>У черзі</span><strong>{stats?.queued ?? 0}</strong></section><section className="panel"><span>Макс. впевненість</span><strong>{stats?.highest?.confidence.toFixed(1) ?? '—'}%</strong></section><section className="panel"><span>Мін. впевненість</span><strong>{stats?.lowest?.confidence.toFixed(1) ?? '—'}%</strong></section></div>
          <section className="panel"><h2>📊 Найчастіші види</h2>{stats?.species.map(x => <p key={x.species}>{x.species} — {x.count}</p>)}</section></>}

        {tab === 'catalog' && <section className="panel"><h2>📚 Довідник птахів ({birds.length})</h2><div className="catalog">{birds.map(bird => <article key={bird.english_name}><b>{bird.ukrainian_name}</b><small>{bird.english_name} · <i>{bird.scientific_name}</i></small><p>{bird.description_uk}</p><a href={bird.source_url} target="_blank" rel="noreferrer">Джерело</a></article>)}</div></section>}
      </div>
    </main>
  </div>;
}
