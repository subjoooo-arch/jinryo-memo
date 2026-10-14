export const DISCLAIMER = '[대화내용요약] - 참고용 기록으로 의료적 판단이나 진단 자료로 사용되지 않습니다.'
export const SYSTEM_PROMPT = `너는 한국 치과의 진료메모 작성 보조다. 상담 대화 녹취록을 받아 dNote에 붙여넣을 일반 텍스트 진료메모를 작성한다.
반드시 아래 형식만 출력한다(마크다운 금지, 코드블록 금지, 앞뒤 설명 금지):

${DISCLAIMER}

■ 상담대화
- (설명/안내/비용/일정 등 상담 내용, 문장 끝은 "~함/~임" 개조식)

■ (S) Subjective
- (환자 주소, 증상, 기간, 과거 치료력 등 환자 진술)

■ #치아번호   (FDI 표기, 예: #36. 대화로 추론한 경우 "#17(추정)", 번호를 알 수 없으면 "#부위 치식불명" 예: "#우상악 치식불명")
- (O) 객관적 소견/검사 결과
- (A&P) 평가 → 계획

규칙:
- 대화에서 실제로 언급된 내용만 쓴다. 소견·검사·진단·비용을 절대 지어내지 않는다.
- 근거 없는 항목은 생략한다(빈 섹션은 통째로 생략, 단 첫 줄 문구와 ■ 상담대화는 항상 유지).
- 치아별 섹션은 해당 치아의 언급이 있을 때만 만든다. (O)가 없으면 (O) 줄 생략.
- 금액, 기간, 횟수 등 숫자는 대화 그대로 옮긴다.
- 섹션 사이에 빈 줄 하나.`

export interface Cfg { key: string; base: string; sttModel: string; chatModel: string }
const url = (c: Cfg, p: string) => c.base.replace(/\/+$/, '') + p
async function err(r: Response) {
  let t = ''; try { t = await r.text() } catch {}
  if (r.status === 401) return new Error('API 키가 올바르지 않습니다 (401).')
  if (r.status === 429) return new Error('요청 한도 초과 또는 크레딧 부족입니다 (429).')
  if (r.status === 413) return new Error('파일이 너무 큽니다 (25MB 이하로 올려주세요).')
  return new Error(`서버 오류 ${r.status}: ${t.slice(0, 200)}`)
}
export async function apiTranscribe(c: Cfg, blob: Blob, name: string) {
  const f = new FormData()
  f.append('file', blob, name); f.append('model', c.sttModel || 'whisper-1'); f.append('language', 'ko')
  f.append('prompt', '치과 상담 대화입니다. 크라운, 신경치료, 임플란트, 발치, 치아 균열, 치수염, 레진, 스케일링, 교합.')
  let r: Response
  try { r = await fetch(url(c, '/audio/transcriptions'), { method: 'POST', headers: { Authorization: `Bearer ${c.key}` }, body: f }) }
  catch { throw new Error('네트워크 오류: 인터넷 연결 또는 Base URL을 확인하세요.') }
  if (!r.ok) throw await err(r)
  return ((await r.json()).text as string || '').trim()
}
export async function apiMemo(c: Cfg, transcript: string, extra: string) {
  let r: Response
  try {
    r = await fetch(url(c, '/chat/completions'), {
      method: 'POST', headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: c.chatModel || 'gpt-4o-mini', temperature: 0.2, messages: [
        { role: 'system', content: SYSTEM_PROMPT + (extra.trim() ? '\n\n추가 지시:\n' + extra : '') },
        { role: 'user', content: '다음 상담 녹취록으로 진료메모를 작성해줘:\n\n' + transcript }] })
    })
  } catch { throw new Error('네트워크 오류: 인터넷 연결 또는 Base URL을 확인하세요.') }
  if (!r.ok) throw await err(r)
  let t: string = (await r.json()).choices?.[0]?.message?.content || ''
  t = t.replace(/^```\w*\n?|```$/gm, '').trim()
  if (!t.startsWith('[대화내용요약]')) t = DISCLAIMER + '\n\n' + t
  return t
}

// 키 없이 규칙 기반 초안
const S_HINT = /(아프|아파|통증|시리|시림|불편|붓|부었|피가|씹을|흔들|소리|벌리|전부터|개월|주 전|며칠|예전에|다른 치과|빠졌|깨졌|부러)/
export function ruleDraft(t: string) {
  const sents = t.replace(/\s+/g, ' ').split(/(?<=[.?!。])\s+|(?<=(?:요|다|죠|까))\s+(?=\S)/).map(s => s.trim()).filter(s => s.length > 3)
  const s: string[] = [], c: string[] = []
  sents.forEach(x => (S_HINT.test(x) ? s : c).push(x))
  const teeth = new Map<string, string[]>()
  const re = /(?:#\s*|\b)([1-4][1-8])\s*번?(?=\s|번|$|[^0-9])/g
  for (const x of sents) for (const m of x.matchAll(re)) {
    if (!/(#|번|치아|치)/.test(x)) continue
    const k = m[1]; if (!teeth.has(k)) teeth.set(k, []); teeth.get(k)!.push(x)
  }
  let out = DISCLAIMER + '\n\n■ 상담대화\n' + (c.length ? c.map(x => '- ' + x).join('\n') : '- (내용 없음)')
  if (s.length) out += '\n\n■ (S) Subjective\n' + s.map(x => '- ' + x).join('\n')
  for (const [k, v] of teeth) out += `\n\n■ #${k}\n` + [...new Set(v)].slice(0, 3).map(x => '- (언급) ' + x).join('\n') + '\n- (O) \n- (A&P)  → '
  return out + '\n\n※ 자동 규칙 초안입니다. 반드시 검토·수정 후 사용하세요.'
}
