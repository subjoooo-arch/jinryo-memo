import { useEffect, useRef, useState } from 'react'
import { apiMemo, apiTranscribe, ruleDraft, Cfg } from './ai'
import { allRecs, delRec, Rec, saveRec } from './db'
import { localTranscribe, toPcm16k } from './local'

const LS = 'jm-cfg'
const def: Cfg & { extra: string; localModel: string } = { key: '', base: 'https://api.openai.com/v1', sttModel: 'whisper-1', chatModel: 'gpt-4o-mini', extra: '', localModel: 'onnx-community/whisper-base' }
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); return true } catch {
    const a = document.createElement('textarea'); a.value = t; a.style.position = 'fixed'; a.style.opacity = '0'
    document.body.appendChild(a); a.select(); const ok = document.execCommand('copy'); a.remove(); return ok
  }
}

export default function App() {
  const [cfg, setCfg] = useState(() => ({ ...def, ...JSON.parse(localStorage.getItem(LS) || '{}') }))
  const [tab, setTab] = useState<'main' | 'set' | 'hist'>('main')
  const [rec, setRec] = useState(false), [sec, setSec] = useState(0)
  const [blob, setBlob] = useState<{ b: Blob; name: string } | null>(null)
  const [tr, setTr] = useState(''), [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(''), [msg, setMsg] = useState(''), [toast, setToast] = useState('')
  const [dict, setDict] = useState(false), [hist, setHist] = useState<Rec[]>([])
  const mr = useRef<MediaRecorder | null>(null), timer = useRef<number>(0), sr = useRef<any>(null), id = useRef(Date.now())
  const hasKey = !!cfg.key.trim()
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

  useEffect(() => { localStorage.setItem(LS, JSON.stringify(cfg)) }, [cfg])
  useEffect(() => { if (tab === 'hist') allRecs().then(setHist).catch(() => setMsg('기록을 불러오지 못했습니다.')) }, [tab])
  useEffect(() => { if (tr || memo) saveRec({ id: id.current, date: new Date(id.current).toLocaleString('ko-KR'), transcript: tr, memo }).catch(() => {}) }, [tr, memo])
  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 1800) }
  const fail = (e: any) => { setMsg('⚠️ ' + (e?.message || String(e))); setBusy('') }

  async function startRec() {
    setMsg('')
    if (!window.isSecureContext) return setMsg('⚠️ 마이크는 HTTPS 주소에서만 사용할 수 있습니다. https:// 로 접속하거나 파일 업로드를 이용하세요.')
    if (!navigator.mediaDevices?.getUserMedia || !(window as any).MediaRecorder) return setMsg('⚠️ 이 브라우저는 녹음을 지원하지 않습니다. 삼성 인터넷/크롬 최신 버전을 사용하세요.')
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const mt = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || ''
      const m = new MediaRecorder(st, mt ? { mimeType: mt } : undefined), ch: BlobPart[] = []
      m.ondataavailable = e => e.data.size && ch.push(e.data)
      m.onstop = () => { st.getTracks().forEach(t => t.stop()); const b = new Blob(ch, { type: m.mimeType || 'audio/webm' }); setBlob({ b, name: 'rec.' + (b.type.includes('mp4') ? 'm4a' : b.type.includes('ogg') ? 'ogg' : 'webm') }) }
      m.start(1000); mr.current = m; setRec(true); setSec(0); id.current = Date.now()
      timer.current = window.setInterval(() => setSec(s => s + 1), 1000)
    } catch (e: any) {
      setMsg(e?.name === 'NotAllowedError' ? '⚠️ 마이크 권한이 거부되었습니다. 주소창 왼쪽 자물쇠 → 권한에서 마이크를 허용하세요.' : '⚠️ 마이크를 열 수 없습니다: ' + e?.message)
    }
  }
  const stopRec = () => { mr.current?.stop(); clearInterval(timer.current); setRec(false) }

  async function transcribe() {
    if (!blob) return; setMsg('')
    try {
      if (hasKey) { setBusy('서버에서 받아쓰기 중…'); setTr(await apiTranscribe(cfg, blob.b, blob.name)) }
      else {
        setBusy('오디오 변환 중…'); const pcm = await toPcm16k(blob.b)
        setTr(await localTranscribe(pcm, cfg.localModel, setBusy))
      }
      setBusy('')
    } catch (e) { fail(e) }
  }
  function toggleDict() {
    if (!SR) return setMsg('⚠️ 이 브라우저는 실시간 음성 받아쓰기를 지원하지 않습니다.')
    if (dict) { sr.current?.stop(); setDict(false); return }
    const r = new SR(); r.lang = 'ko-KR'; r.continuous = true; r.interimResults = false
    r.onresult = (e: any) => { let t = ''; for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) t += e.results[i][0].transcript + ' '; setTr(p => (p + ' ' + t).trim()) }
    r.onerror = (e: any) => setMsg('⚠️ 받아쓰기 오류: ' + e.error)
    r.onend = () => { if (sr.current === r && dictRef.current) r.start() }
    sr.current = r; r.start(); setDict(true)
  }
  const dictRef = useRef(false); dictRef.current = dict
  async function genMemo() {
    if (!tr.trim()) return setMsg('⚠️ 먼저 대화 내용(녹취록)이 필요합니다.')
    setMsg('')
    if (!hasKey) { setMemo(ruleDraft(tr)); flash('규칙 기반 초안 생성 (키 없음)'); return }
    try { setBusy('진료메모 작성 중…'); setMemo(await apiMemo(cfg, tr, cfg.extra)); setBusy('') } catch (e) { fail(e) }
  }
  const cp = async (t: string, n: string) => flash((t && await copyText(t)) ? `${n} 복사됨 ✓` : '복사 실패 — 길게 눌러 직접 복사하세요')
  const reset = () => { setBlob(null); setTr(''); setMemo(''); setMsg(''); id.current = Date.now() }

  return <div className="app">
    <header><h1>🦷 진료메모</h1><nav>
      {(['main', 'hist', 'set'] as const).map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ main: '작성', hist: '기록', set: '설정' }[t]}</button>)}
    </nav></header>
    {msg && <div className="msg" onClick={() => setMsg('')}>{msg}</div>}
    {busy && <div className="busy"><span className="spin" />{busy}</div>}

    {tab === 'main' && <main>
      <section className="card">
        <h2>1. 녹음 / 파일</h2>
        <div className="row">
          {!rec ? <button className="big rec" onClick={startRec}>● 녹음 시작</button>
            : <button className="big stop" onClick={stopRec}>■ 녹음 중지 {fmt(sec)}</button>}
          <label className="big ghost">📁 파일 올리기<input type="file" hidden accept="audio/*,video/mp4,.m4a,.mp3,.wav,.webm,.ogg,.mp4"
            onChange={e => { const f = e.target.files?.[0]; if (f) { setBlob({ b: f, name: f.name }); id.current = Date.now() } e.target.value = '' }} /></label>
          <button className="big ghost" onClick={reset}>↺ 새 상담</button>
        </div>
        {blob && <div className="row"><audio controls src={URL.createObjectURL(blob.b)} />
          <button className="big pri" disabled={!!busy} onClick={transcribe}>📝 받아쓰기 {hasKey ? '(API)' : '(기기 내)'}</button></div>}
        {!hasKey && SR && <div className="row"><button className={'big ghost' + (dict ? ' live' : '')} onClick={toggleDict}>{dict ? '■ 실시간 받아쓰기 중지' : '🎙 실시간 받아쓰기 (브라우저)'}</button></div>}
        {!window.isSecureContext && <p className="tip">💡 마이크는 HTTPS 주소에서만 동작합니다.</p>}
      </section>
      <section className="card">
        <div className="hd"><h2>2. 대화 내용</h2><button className="cp" onClick={() => cp(tr, '대화 내용')}>📋 복사</button></div>
        <textarea value={tr} onChange={e => setTr(e.target.value)} placeholder="받아쓰기 결과가 여기에 표시됩니다. 직접 입력·수정도 가능합니다." rows={8} />
        <button className="big pri wide" disabled={!!busy} onClick={genMemo}>✨ 진료메모 만들기 {hasKey ? '' : '(규칙 기반 초안)'}</button>
      </section>
      <section className="card">
        <div className="hd"><h2>3. 진료메모</h2><button className="cp" onClick={() => cp(memo, '진료메모')}>📋 복사</button></div>
        <textarea className="memo" value={memo} onChange={e => setMemo(e.target.value)} rows={16} placeholder="생성된 진료메모 (dNote에 붙여넣기)" />
        <button className="big pri wide" onClick={() => cp(memo, '진료메모')}>📋 진료메모 복사</button>
      </section>
    </main>}

    {tab === 'hist' && <main>{hist.length === 0 && <p className="tip">저장된 기록이 없습니다.</p>}
      {hist.map(h => <section className="card" key={h.id}>
        <div className="hd"><h2>{h.date}</h2><div className="row">
          <button className="cp" onClick={() => { id.current = h.id; setTr(h.transcript); setMemo(h.memo); setTab('main') }}>열기</button>
          <button className="cp" onClick={() => cp(h.memo, '진료메모')}>📋</button>
          <button className="cp" onClick={async () => { if (confirm('삭제할까요?')) { await delRec(h.id); setHist(await allRecs()) } }}>🗑</button></div></div>
        <pre>{(h.memo || h.transcript).slice(0, 300)}</pre></section>)}</main>}

    {tab === 'set' && <main><section className="card">
      <h2>API 설정 (OpenAI 호환)</h2>
      <p className="tip">키는 이 기기의 브라우저(localStorage)에만 저장되며 설정한 서버 외에는 전송되지 않습니다. 키가 없으면 기기 내 Whisper + 규칙 기반 초안으로 동작합니다.</p>
      {([['key', 'API 키', 'sk-...'], ['base', 'Base URL', 'https://api.openai.com/v1'], ['sttModel', '받아쓰기 모델', 'whisper-1'], ['chatModel', '메모 생성 모델', 'gpt-4o-mini']] as const).map(([k, l, p]) =>
        <label className="fld" key={k}>{l}<input type={k === 'key' ? 'password' : 'text'} value={(cfg as any)[k]} placeholder={p} onChange={e => setCfg({ ...cfg, [k]: e.target.value })} /></label>)}
      <label className="fld">추가 작성 지시 (선택)<textarea rows={3} value={cfg.extra} onChange={e => setCfg({ ...cfg, extra: e.target.value })} placeholder="예: 비용은 상담대화 마지막 줄에 정리" /></label>
      <label className="fld">기기 내 Whisper 모델 (키 없을 때)<select value={cfg.localModel} onChange={e => setCfg({ ...cfg, localModel: e.target.value })}>
        <option value="onnx-community/whisper-tiny">tiny (~40MB, 빠름·정확도 낮음)</option>
        <option value="onnx-community/whisper-base">base (~80MB, 권장)</option>
        <option value="onnx-community/whisper-small">small (~250MB, 느림·정확도 높음)</option></select></label>
      <button className="big ghost" onClick={() => setCfg({ ...cfg, key: '' })}>키 삭제</button>
    </section></main>}
    {toast && <div className="toast">{toast}</div>}
  </div>
}
