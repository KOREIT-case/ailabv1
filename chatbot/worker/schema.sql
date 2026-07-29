-- schema.sql — 미답변 질문 기록 테이블 (Cloudflare D1)
--
-- 적용:  node scripts/unanswered.mjs --init
--   (내부적으로: cd chatbot/worker && npx wrangler d1 execute LOGS_DB --remote --file=schema.sql)
--
-- 설계 메모
--  · PK 가 qhash(정규화 질문의 해시)라서 같은 질문이 반복되면 행이 늘지 않고
--    hit_count 만 올라간다. → "여러 사람이 반복해서 막힌 질문"이 곧 보완 우선순위.
--  · top_hits 가 원인 3분류(범위밖 / 자료없음 / 검색실패)의 판별 근거다.
--    이게 없으면 "왜 못 답했는지"를 나중에 재구성할 수 없다.
--  · 성공한 질문은 저장하지 않는다(실패 3종만). 저장량·프라이버시 부담을 줄인다.

CREATE TABLE IF NOT EXISTS unanswered (
  qhash       TEXT PRIMARY KEY,          -- 정규화 질문의 SHA-256 앞 16자리 = 중복 집계 키
  question    TEXT NOT NULL,             -- 질문 원문
  reason      TEXT NOT NULL,             -- 검색0건 | 모델거절 | 근거미표시
  q_type      TEXT,                      -- 질의유형(GA q_type 과 같은 분류)
  scope       TEXT,                      -- 검색범위 라벨 "법령+조례(서울특별시)"
  user_hash   TEXT,                      -- 이름 8자리 해시(GA user_id 와 같은 값 → 교차 확인 가능)
  top_hits    TEXT,                      -- JSON 배열 [{자료유형,법령명,조문,score}] 최대 7건
  answer_head TEXT,                      -- 답변 앞 300자(거절 문구 또는 근거 없는 답변의 서두)
  first_ts    TEXT NOT NULL,             -- 최초 발생(ISO8601)
  last_ts     TEXT NOT NULL,             -- 최근 발생(ISO8601)
  hit_count   INTEGER NOT NULL DEFAULT 1,-- 재발 횟수 = 우선순위
  status      TEXT NOT NULL DEFAULT '미처리', -- 미처리|자료추가|검색보정|범위밖|보류|해결
  note        TEXT,                      -- 검토 메모(무슨 자료를 넣었는지 등)
  resolved_at TEXT                       -- 상태를 바꾼 시각
);

-- 검토 목록의 기본 정렬: 미처리 중 많이 막힌 순.
CREATE INDEX IF NOT EXISTS idx_unanswered_queue ON unanswered(status, hit_count DESC);
-- 원인별 집계용.
CREATE INDEX IF NOT EXISTS idx_unanswered_reason ON unanswered(reason);
