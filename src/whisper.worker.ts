import { pipeline, env } from '@huggingface/transformers'
env.allowLocalModels = false; env.useBrowserCache = true
let asr: any = null, cur = ''
self.onmessage = async (e: MessageEvent) => {
  const { audio, model } = e.data
  try {
    if (!asr || cur !== model) {
      const dev = (navigator as any).gpu ? 'webgpu' : 'wasm'
      asr = await pipeline('automatic-speech-recognition', model, {
        device: dev as any, dtype: dev === 'webgpu' ? 'fp32' : 'q8',
        progress_callback: (p: any) => { if (p.status === 'progress') self.postMessage({ type: 'dl', file: p.file, pct: p.progress }) }
      } as any)
      cur = model
    }
    self.postMessage({ type: 'run' })
    const out: any = await asr(audio, { language: 'korean', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 })
    self.postMessage({ type: 'done', text: (Array.isArray(out) ? out.map((o: any) => o.text).join(' ') : out.text).trim() })
  } catch (err: any) { self.postMessage({ type: 'error', msg: String(err?.message || err) }) }
}
