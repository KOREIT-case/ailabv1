// jumin.mjs — 행정안전부 주민등록 인구통계(jumin.mois.go.kr) 내려받기 공통부.
//
// 이 사이트에는 두 가지 함정이 있어서 평범한 fetch()로는 못 받는다.
//   1) TLS 1.3 을 제시하면 서버가 핸드셰이크 도중 연결을 끊는다(Recv failure).
//      → maxVersion 을 TLSv1.2 로 고정해야 한다.
//   2) 응답 CSV 인코딩이 UTF-8 이 아니라 CP949 다. 그대로 읽으면 전부 깨진다.
//      → TextDecoder('euc-kr') 로 디코딩한다.
// 이 두 줄을 몰라서 헤매기 쉬우므로 한 곳에 모아 둔다.
import https from 'node:https';

const HOST = 'jumin.mois.go.kr';
const UA = 'Mozilla/5.0 (compatible; ailabv1-region/1.0)';

// TLS 1.2 고정 + 재시도. 정부 사이트라 간헐적으로 연결이 끊긴다.
export function request(path, { method = 'GET', body = null, referer = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST, path, method,
      maxVersion: 'TLSv1.2', minVersion: 'TLSv1.2',
      headers: {
        'User-Agent': UA,
        ...(referer ? { Referer: `https://${HOST}/${referer}` } : {}),
        ...(body ? {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(300_000, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

export async function retry(fn, { tries = 4, label = '' } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      const wait = 2000 * 2 ** i;
      process.stderr.write(`  ! ${label} 실패(${e.message}) — ${wait / 1000}초 뒤 재시도\n`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}

export const decodeCp949 = (buf) => new TextDecoder('euc-kr').decode(buf);

// 사이트가 지금 최신으로 들고 있는 연·월을 hidden input 에서 읽는다.
// 통계는 매월 갱신되므로 연월을 코드에 박아 두면 다음 달에 조용히 낡는다.
export async function latestMonth() {
  const { status, buf } = await request('/ppltHshdStus.do');
  if (status !== 200) throw new Error(`ppltHshdStus.do HTTP ${status}`);
  const html = decodeCp949(buf);
  const y = html.match(/name="searchYearStart"[^>]*>/) && html.match(/value="(\d{4})"\s+name="searchYearStart"/);
  const m = html.match(/value="(\d{2})"\s+name="searchMonthStart"/);
  if (!y || !m) throw new Error('최신 연월을 찾지 못했습니다 (사이트 구조 변경?)');
  return { year: y[1], month: m[1] };
}

// 법정동 기준 통계가 존재하는 연도 목록(사이트 select 에 있는 그대로).
// 법정동별 통계는 행정동별보다 늦게 시작해서, 없는 연도를 요청하면 오류 대신
// '전부 0' 인 CSV 가 돌아온다. 그대로 쓰면 "그 해 인구 0명" 인 그래프가 나온다.
export async function availableYears() {
  const { status, buf } = await request('/ppltHshdStus.do');
  if (status !== 200) throw new Error(`ppltHshdStus.do HTTP ${status}`);
  const sel = /<select[^>]*name="searchYearStart"[\s\S]*?<\/select>/.exec(decodeCp949(buf));
  if (!sel) throw new Error('조회 가능 연도를 찾지 못했습니다 (사이트 구조 변경?)');
  return [...sel[0].matchAll(/value="(\d{4})"/g)].map((m) => m[1]).sort();
}

// 통계 4종. state=3 = '전체읍면동현황'(법정동 전수), downType=Csv.
// 각 항목의 hidden 파라미터 구성은 페이지마다 다르다 — 페이지 소스에서 그대로 옮겼다.
const COMMON = 'sltOrgLvl1=A&sltOrgLvl2=&sltUndefType=&category=month&state=3';

export const DATASETS = {
  // 총인구·세대수·세대당인구·남·여
  pplt: {
    endpoint: 'ppltHshdStusDown.do', referer: 'ppltHshdStus.do',
    form: (y, m) => `sltOrgType=&${COMMON}&gender=gender&genderPer=genderPer&generation=generation`
      + `&searchYearStart=${y}&searchMonthStart=${m}&searchYearEnd=${y}&searchMonthEnd=${m}`,
  },
  // 5세 구간 연령별 인구(계/남/여). 10세 구간으로는 유소년(0~14세)을 못 가른다.
  age: {
    endpoint: 'agePpltStusDown.do', referer: 'agePpltStus.do',
    form: (y, m) => `${COMMON}&sltArgTypes=5&sltArgTypeA=0&sltArgTypeB=100&sttsGbn=&sum=sum&gender=gender`
      + `&searchYearStart=${y}&searchMonthStart=${m}&searchYearEnd=${y}&searchMonthEnd=${m}`,
  },
  // 세대원수별 세대수(1인~10인이상)
  hsmb: {
    endpoint: 'hsmbHshdDown.do', referer: 'hsmbHshd.do',
    form: (y, m) => `sltOrgType=&${COMMON}`
      + `&searchYearStart=${y}&searchMonthStart=${m}&searchYearEnd=${y}&searchMonthEnd=${m}`,
  },
  // 평균연령(계/남/여)
  avg: {
    endpoint: 'avgAgeDown.do', referer: 'avgAge.do',
    form: (y, m) => `sltOrgType=&${COMMON}&sum=sum&gender=gender`
      + `&searchYearStart=${y}&searchMonthStart=${m}&searchYearEnd=${y}&searchMonthEnd=${m}`,
  },
};

export async function download(kind, year, month) {
  const d = DATASETS[kind];
  if (!d) throw new Error(`알 수 없는 통계 종류: ${kind}`);
  const { status, buf } = await request(
    `/${d.endpoint}?searchYearMonth=month&xlsStats=3&downType=Csv`,
    { method: 'POST', body: d.form(year, month), referer: d.referer },
  );
  if (status !== 200) throw new Error(`${d.endpoint} HTTP ${status}`);
  // 오류일 때 HTML 을 200 으로 돌려주는 사이트라, 내용으로 한 번 더 확인한다.
  const text = decodeCp949(buf);
  if (!text.startsWith('"법정구역"')) throw new Error(`${d.endpoint} 응답이 CSV 가 아님 (${text.slice(0, 80)})`);
  return text;
}
