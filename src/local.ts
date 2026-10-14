export async function toPcm16k(blob: Blob): Promise<Float32Array> {
  const buf = await blob.arrayBuffer()
  const ac = new AudioContext()
  let d: AudioBuffer
  try { d = await ac.decodeAudioData(buf) } catch { throw new Error('오디오를 해석할 수 없습니다. 다른 형식(m4a/mp3/wav)으로 시도하세요.') } finally { ac.close() }
  const off = new OfflineAudioContext(1, Math.ceil(d.duration * 16000), 16000)
  const s = off.createBufferSource(); s.buffer = d; s.connect(off.destination); s.start()
  return (await off.startRendering()).getChannelData(0)
}
let w: Worker | null = null
export function localTranscribe(audio: Float32Array, model: string, onP: (m: string) => void) {
  w ??= new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
  return new Promise<string>((res, rej) => {
    w!.onmessage = (e) => {
      const m = e.data
      if (m.type === 'dl') onP(`모델 다운로드 중 (최초 1회, 이후 캐시): ${m.file?.split('/').pop()} ${Math.round(m.pct || 0)}%`)
      else if (m.type === 'run') onP('기기 내 받아쓰기 중… (길이에 따라 수 분 소요)')
      else if (m.type === 'done') res(m.text)
      else if (m.type === 'error') rej(new Error('기기 내 받아쓰기 실패: ' + m.msg))
    }
    w!.postMessage({ audio, model }, [audio.buffer])
  })
}
