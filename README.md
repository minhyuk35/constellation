# Constellation — 별로 그리는 사람

기존 Three.js 데모를 기능별 모듈로 분리한 웹캠 인터랙티브 미디어아트입니다. 큰 화면에서 손으로 만든 별자리를 QR로 등록하고, 관람객 휴대폰의 방향 센서·카메라로 감상하는 전시 흐름을 제공합니다. 기존 `plan.html`, `hand-test.html`, `panel.html`, 작품설명서 파일은 보존했습니다.

## 실행

Node.js **22.13 이상**이 필요합니다. 이 PC의 Node 24에서 검증했습니다. Cloudflare 개발 도구와 SQLite 테스트 때문에 최소 버전을 올렸습니다.

```powershell
cd 'C:\Users\user\Desktop\2학년 B반\Github\constellation'
npm.cmd install
npm.cmd run dev
```

터미널에 표시된 주소(기본 `http://127.0.0.1:5173`)를 엽니다. Windows PowerShell 실행 정책에 영향을 받지 않도록 `npm.cmd`를 표기했습니다. 다른 셸에서는 `npm`을 사용해도 됩니다. `index.html` 더블클릭이나 기존 단순 정적 서버 대신 Vite 개발 서버로 실행합니다.

최초 설치 시 MediaPipe 손 인식 모델·WASM과 MoveNet MultiPose 모델을 `public/models`, `public/wasm`에 준비합니다. 손 인식은 브라우저 안에서 실행하며 외부 API 키가 필요 없습니다. 생성되는 모델·WASM은 Git에서 제외했으며, 다운로드가 실패했다면 `npm.cmd run setup:vision`을 다시 실행합니다.

`npm run dev`는 Vite(5173)와 로컬 D1 API(8787)를 함께 실행하고 DB 스키마를 준비합니다. 로그인 없이 전시 전체 흐름을 시험할 수 있으며 DB는 `worker/.wrangler/state/`에 유지됩니다. 종료는 실행 터미널에서 `Ctrl+C`입니다. 공유 기능 없이 편집 화면만 실행하려면 `npm run dev:canvas`를 사용합니다. 이때 서버가 없으므로 QR 등록은 실패하지만 편집·손 인식·PNG 저장은 계속 가능합니다.

```powershell
npm.cmd test          # 형태 인식·편집·손짓 분류 검증
npm.cmd run build     # 배포용 dist 생성
npm.cmd run preview   # 빌드 결과 로컬 확인
npm.cmd run test:browser
npm.cmd run test:exhibition # 별도 익명 브라우저까지 포함한 QR·공개·댓글·좋아요·캡처
node tests/browser-kiosk-continuous.mjs # 같은 화면에서 연속 손 이동에 따른 새 QR·이전 QR 보존·늦은 응답 검증
npm.cmd run worker:check    # Cloudflare Worker 번들 검사, 실제 업로드 없음
```

브라우저 검증은 개발 서버가 실행된 상태에서 별도로 실행합니다. Windows에 설치된 Chrome/Edge를 사용하며, 다른 환경에서는 `CHROME_PATH` 환경 변수로 브라우저 실행 파일을 지정하거나 `npx playwright install chromium`으로 준비합니다. `TEST_URL`로 미리보기 서버 주소를 지정할 수 있습니다. 이 테스트는 **가상 카메라**로 모델 로딩과 추론을 확인합니다. 실제 웹캠의 조명·거리·손짓 감도는 현장에서 별도로 확인해야 합니다.

## 손 좌표 떨림 보정

기존 손 입력은 인식 결과마다 고정 비율 `0.42`로 좌표를 섞고, 그때만 별을 이동했습니다. 인식 요청은 최소 55ms 간격(60Hz 렌더링에서는 보통 4프레임, 약 67ms)이지만 Three.js는 매 화면 프레임을 그리므로 손 이동이 계단처럼 보일 수 있었습니다. 기존 집기 거리 히스테리시스도 한 프레임의 주먹 오인식은 막지 못했습니다. 또한 흔들기 판정에 `model.move()`의 보정 좌표와 손의 원본 좌표가 번갈아 들어가, 보정 지연 자체가 가짜 방향 전환으로 계산될 수 있었습니다.

손 입력에만 다음을 적용했습니다. 마우스·터치의 직접 이동 경로와 별 생성·연결·삭제·되돌리기는 유지합니다. 새 라이브러리는 없습니다.

- **One Euro Filter**: 손마다 독립된 2D 상태로 CSS 픽셀 좌표를 처리합니다. 정지 중에는 강하게 보정하고, 속도가 커지면 `minCutoff + beta × speed`로 차단 주파수를 높여 지연을 줄입니다. Worker가 반환한 촬영 요청 시각으로 실제 샘플 간격을 계산합니다. [원 논문, Appendix A](https://gery.casiez.net/publications/CHI2012-casiez.pdf)를 기준으로 구현했습니다.
- **작은 소프트 데드존**: 정지 시 반경 1.25px, 빠른 이동 시 0.25px입니다. 마지막으로 받아들인 위치에서 누적 변위를 비교하므로 프레임당 0.05px 같은 작은 의도적 이동도 쌓이면 반영됩니다. 경계를 넘을 때는 초과한 거리만 이동하여 튀는 현상을 줄입니다.
- **거리·시간 히스테리시스**: 집기 시작/해제 비율 0.32/0.48을 유지하고, 새 제스처가 연속 샘플에서 30ms 이상 관찰될 때만 전환합니다. 일반적인 입력에서는 다음 인식 결과 한 번을 더 기다립니다. 놓기 후보를 확인하는 동안 손가락이 벌어지거나 접히면서 바뀐 좌표는 별 이동과 흔들기 판정에 넣지 않습니다.
- **렌더 프레임 보간**: 요청 간격을 33ms로 줄이고 카메라에는 최대 30fps를 요청합니다. 실제 주기는 카메라·CPU·렌더링 성능에 따라 달라집니다. 추론은 한 번에 하나만 진행하며 중복 영상 프레임은 건너뜁니다. 별과 커서를 기존 Three.js 프레임에서 함께 갱신하고 새 목표까지 8~24ms만 보간합니다. 전체 인식 프레임을 추가로 버퍼링하거나 미래 위치를 외삽하지 않습니다.
- **수명과 삭제 판정**: 250ms 이상 손을 잃거나 카메라를 끄면 잡기·필터 상태를 초기화합니다. 오래되거나 중복된 결과는 사용하지 않습니다. 흔들기에는 정상 집기로 확인된 원본 좌표를 인식 결과당 한 번만 넣어 의도적인 빠른 삭제를 유지합니다.

기본값은 `src/config.js`에서 조절할 수 있습니다. 화면 픽셀은 CSS 픽셀 기준이며 웹캠 해상도나 디스플레이 배율과 별개입니다.

| 파라미터 | 기본값 | 조절 효과 |
| --- | --- | --- |
| `handMotion.minCutoff` | 1.5 Hz | 낮추면 정지 떨림 감소, 느린 이동 지연 증가 |
| `handMotion.beta` | 0.025 | 높이면 빠른 이동 반응 증가, 움직이는 중 보정 감소 |
| `handMotion.derivativeCutoff` | 1 Hz | 속도 추정의 보정 정도. 높이면 가속에 더 빨리 반응 |
| `handMotion.deadZone` / `movingDeadZone` | 1.25 / 0.25 px | 정지/빠른 이동에서 무시하는 반경 |
| `handMotion.responsiveSpeed` | 350 px/s | 최소 데드존·최단 보간 시간에 도달하는 속도 |
| `handMotion.interpolationMs` | 24 ms | 최대 보간 시간. 빠른 이동에서는 1/3로 축소 |
| `handGestures.pinchEnter` / `pinchExit` | 0.32 / 0.48 | 손바닥 크기로 정규화한 집기 시작/해제 거리 |
| `handGestures.confirmMs` | 30 ms | 새 제스처의 최소 확인 시간. 연속 인식 결과도 필요 |
| `handDetectInterval` / `handLostAfter` | 33 / 250 ms | 최소 인식 요청 간격 / 손 유실 후 해제 시간 |
| `handGrabRadius` | 76 px | 손 집기 반경. 가까운 별부터 선택하며 마우스와 주먹 생성 판정에는 영향 없음 |

수정 파일은 `src/config.js`, `src/interaction/HandController.js`, `gestures.js`, `hand.worker.js`, `CanvasModel.js`이며, `src/interaction/HandMotion.js`와 `tests/hand-motion.test.js`, `tests/hand-controller.test.js`를 추가했습니다. `CanvasModel.move()`의 흔들기 판정 옵션은 기본적으로 켜져 있어 기존 마우스 동작을 유지합니다.

자동 검증은 `npm.cmd test`, `npm.cmd run build`, 개발 서버 실행 후 `npm.cmd run test:browser`로 실행합니다. 합성 노이즈(고정 시드, ±5px, 30Hz) 시험의 위치 오차 RMS는 원본 2.86px → 기존 보정 1.50px → 새 보정 0.82px입니다. 800px/s 이동에서 30Hz 샘플 목표 대비 오차는 36.81px → 5.39px로 줄었습니다. 이 수치는 결정적인 합성 입력 시험이며 실제 웹캠의 정확도나 카메라·추론을 포함한 총 지연 측정값은 아닙니다. 테스트는 8/15/24/30Hz, 느린 6px 이동, 두 손의 결과 순서 변경, 한 프레임 제스처 오류, 보간, 손 유실, 주먹 생성, 흔들기 삭제와 되돌리기를 검증합니다.

2026-10-17 성능 점검에서는 손 이동마다 연결선 `BufferGeometry`를 폐기·재생성하던 부분을 고정 버퍼 재사용으로 변경했습니다. 최대 48개 별 사이의 1,128개 연결을 수용하며 사용한 구간만 GPU에 갱신합니다. 같은 별 개수·안내 문구·버튼 상태는 DOM에 다시 쓰지 않고, 손 커서는 `left/top` 대신 `transform`으로 이동합니다. 주변 사람의 월드 좌표도 입자마다 반복 계산하지 않고 프레임당 한 번 계산합니다. 손 집기 반경은 52→76 CSS px로 넓혔으며, 인식 모델, Worker 구조, 나머지 제스처·필터 설정, 주변 사람 인식 주기는 유지했습니다.

Chrome 자동 재현(1440×900, 별 48개·연결 47개, 합성 손 입력 약 3.5초)에서 연결선 재생성 182→0회, 레이아웃 계산 284→24회, DOM 변경 1,943→275회로 감소했습니다. 이는 해당 실행의 렌더링 부하 비교이며 실제 웹캠의 전체 입력 지연이나 FPS 개선율을 의미하지 않습니다. 개발 서버에서 `node tests/browser-hand-performance.mjs`로 버퍼 재사용, 커서 정렬, 최대 연결 수, 드래그·선 드러남·초기화·리사이즈를 회귀 검사할 수 있습니다.

실제 웹캠에서는 카메라를 연결한 뒤 다음 순서로 확인합니다.

1. 중앙에서 손바닥을 1초 펼쳐 조작권을 얻습니다. 별을 집고 3초 정지하여 떨림과 잡기 반복 여부를 확인합니다.
2. 별을 몇 픽셀만 천천히 옮긴 뒤 빠르게 한 방향으로 옮깁니다. 미세 이동이 반영되고 빠른 이동이 삭제로 오인되지 않아야 합니다.
3. 집기를 풀고 다시 집기, 주먹 1초로 별 생성, 좌우로 빠르게 흔들어 삭제, `Ctrl+Z` 복원을 확인합니다.
4. 다른 사람이 손을 흔들거나 앞을 지나가도 선택한 손 외의 입력이 별을 옮기지 않는지 확인합니다. 손이 겹치면 일시정지하고 다시 손바닥을 펼쳐 재개합니다.
5. 카메라 끄기/다시 연결, 마우스 생성·드래그·삭제·되돌리기를 확인합니다.

## 전시 참여 흐름과 손 조작권

- `index.html`: 큰 모니터에서 만들기. 실제 편집 후 형태 발견 → 작성자 QR 자동 표시. 별을 다시 편집하면 이전 QR을 숨기고, 새 이름·별 배치·연결이 완성되면 새 작품의 QR을 표시합니다. 같은 완성 상태의 재시도와 미세한 좌표 흔들림은 기존 QR을 유지합니다. 등록한 작품은 스냅샷으로 보관하므로 다음 작품을 만들어도 이전 QR의 별·이야기는 바뀌지 않습니다. 편집 전 시작된 저장 응답이 늦게 도착해도 이전 QR을 다시 표시하지 않습니다.
- `create.html?id=...#claim=...`: 만든 사람의 QR. 24시간 안에 닉네임(24자)·이야기(500자)를 한 번 등록합니다. QR의 긴 비밀값은 주소의 fragment로 전달하고 페이지가 세션 저장소로 옮겨 주소에서 제거합니다. **먼저 QR을 스캔해 등록한 사람이 작성자**이므로 작성자 QR은 만든 사람에게 보여주세요. 얼굴 인증이나 계정 로그인은 없습니다.
- `entrance.html`: 항상 같은 감상용 `sky.html` 주소를 담은 QR. 다른 노트북에 띄우거나 인쇄·PNG 저장할 수 있습니다. 관람객에게는 이 QR을 제공합니다.
- `sky.html`: 익명 입장. ‘카메라로 하늘 열기’를 누르면 카메라 배경 위에 방향 센서를 적용한 하늘을 봅니다. 작성자도 일반 관람객과 같은 하늘로 들어가며, 작품은 서버에서 정한 무작위의 고정된 상공 위치에 남습니다. 자신의 작품이나 최신 작품을 정면으로 옮기지 않으며, 실제 기기의 기울기를 사용하므로 바닥을 보고 입장해도 상공의 별자리가 바닥에 놓이지 않습니다. 중앙에 가까운 별자리의 ‘이야기 보기’가 켜지고 작성자·이야기·좋아요·익명 댓글(300자)을 볼 수 있습니다. 목록 선택은 필요 없으며, 화면 밖 별자리는 방향 안내를 따라 휴대폰을 움직여 만납니다. 카메라·센서 거부 시 터치/마우스 회전으로 이용합니다. 기존 공개 작품도 도감 이름을 통해 삽화를 표시하며, 화면 근처의 그림만 불러오고 같은 아틀라스 텍스처는 공유합니다. 도감에 없는 자유형 작품은 원래의 별과 선으로 표시합니다. ‘사진 저장’은 현재 보이는 카메라 영상·삽화·별을 합성해 기기에 저장하며 서버에 업로드하지 않습니다.

이 구현은 **방향 센서 기반 AR**입니다. 바닥 인식, 6DoF 위치 추적, 실제 전시장 안의 공통 공간 앵커는 구현하지 않습니다. 걸음을 옮겨도 별의 거리나 시차가 실제 공간처럼 바뀌지는 않습니다. 센서의 방위 기준은 기기마다 다를 수 있어 모든 관람객에게 같은 실제 벽 위에 같은 별이 고정됨을 보장하지 않습니다. 물리 안내판·이미지 마커는 필요 없습니다. 실제 iPhone/Safari와 Android/Chrome에서 HTTPS·센서·카메라 권한을 현장 확인해야 합니다.

하늘 위쪽에 **97개 자리**를 두고 서버가 빈 자리를 무작위로 배정합니다. 각 작품은 반경 5.5° 원 안에 들어가고 자리 간 최소 간격은 13°보다 큽니다. DB의 `UNIQUE(slot)`과 하나의 INSERT 문으로 동시 등록도 충돌하지 않습니다. 정원에 도달하면 명확한 안내를 표시하고 겹쳐 넣지 않습니다. 미등록 QR은 24시간 후 신규 생성 시 정리됩니다. 같은 도감 모양은 여러 사람이 만들 수 있으며, 같은 화면에서 계속 편집해도 새로 완성한 작품에는 새 QR을 발급합니다. ‘새로운 우주’ 또는 조작권을 새로 얻은 다음 참가자도 새 작품으로 시작합니다. `src/exhibition/work-identity.js`의 `WORK_COORD_TOLERANCE`(정규화 반경 기준 0.02)는 같은 작품에서 손 좌표의 미세한 흔들림으로 QR이 반복 발급되는 것을 막습니다. 이름·별 개수·연결이 바뀌면 허용 오차와 무관하게 새 작품입니다.

조작권은 `src/interaction/HandControlGate.js`, 설정은 `src/config.js`의 `handControl`입니다.

| 설정 | 기본값 | 의미 |
| --- | --- | --- |
| `enabled` | true | 한 손 선택 사용. false이면 기존 두 손 조작 경로 |
| `armMs` | 1000ms | 열린 손바닥 유지 시간 |
| `releaseMs` | 2200ms | 마지막 관측 후 다음 참가자를 허용하는 시간 |
| `sampleGapMs` | 300ms | 연속 추적이 끊겼다고 판단하는 간격 |
| `matchRadius` | 0.20 | 화면 정규화 좌표에서 소유 손을 찾는 최대 거리 |
| `ambiguityRadius` | 0.10 | 두 손이 가까워지면 조작을 멈추는 거리 |
| `centerMargin` | 0.25 | 처음 선택할 때 좌우 중앙 50% 영역 |

위치·손바닥 크기·신뢰도 높은 좌우 손 분류를 함께 사용합니다. 얼굴이나 사람의 신원을 식별하는 방식이 아니므로 같은 크기의 같은 쪽 손이 완전히 겹쳐 교체되는 경우까지 보장하지 않습니다. 검출 손이 교차하거나 사라지면 즉시 드래그를 해제하고 손바닥 재확인을 요구합니다. 두 사람이 동시에 중앙에서 시작하면 아무도 선택하지 않습니다. 배경의 MoveNet 관람객 잔상 효과는 기존처럼 별도 동작하며 작품 편집에는 관여하지 않습니다.

2026-10-17부터 `sky.html`은 접속할 때 공개 작품 중 최대 30개를 무작위로 선택합니다. 감상 중에는 같은 선택을 유지하고, 삭제 등으로 자리가 비었을 때만 새 작품을 채웁니다. 작품의 상공 방향은 그대로입니다. 휴대폰(폭 760px 미만)의 수직 시야각은 65°→48°로 조정하여 별자리와 삽화를 약 1.4배 크게 표시합니다. 작품 자체의 각도·영역은 넓히지 않아 이웃 별자리와의 간격을 유지합니다.

이미 공개된 같은 도감 이름에는 작성자 QR을 발급하지 않고 ‘닉네임 님이 이미 이 별자리를 차지했어요!’를 표시합니다. QR을 보여주는 동안에도 3초마다 소유 상태를 확인합니다. 서버의 등록·작성 단계가 모두 확인하고, 동시 작성은 조건부 SQL 한 문장으로 한 사람만 공개하도록 처리합니다. 이전 공개 작품·댓글은 수정하거나 삭제하지 않습니다. 도감에 해당하지 않는 `이름 없는 별자리` 자유형 작품은 서로 다른 작품으로 취급합니다.

## Meta Quest WebXR 작업 공간

`vr.html`은 전시 API·QR을 호출하지 않는 독립적인 VR 작업 공간입니다. Meta Quest Browser에서 HTTPS 주소를 열고 헤드셋의 손 추적을 켠 다음 ‘Meta Quest로 VR 시작’을 누릅니다. `immersive-vr` / `local-floor` 세션에서 `hand-tracking`을 요청하고, 헤드셋이 전달하는 손 관절 좌표를 사용합니다. 지원 여부는 런타임에서 확인하며 손 추적을 쓸 수 없으면 컨트롤러의 포인터·트리거도 동작합니다. 일반 PC에서는 마우스로 3D 미리보기를 제공하고 VR 입장 버튼을 비활성화합니다. [Meta의 WebXR Hands 설명](https://developers.meta.com/vr/documentation/web/webxr-hands/)을 기준으로 구현했습니다.

- 엄지·검지로 빈 공간 집기: 별 생성. 가까운 별 또는 포인터로 가리킨 별을 집고 움직이기: XYZ 공간 이동. 손을 놓치면 즉시 놓으며, 다시 손을 편 다음에 집어야 재개합니다.
- VR 안의 하단 패널: 완성해서 띄우기 / 되돌리기 / 별 지우기 / VR 나가기. 완성 후 빈 작업 공간에서 다음 별자리를 만듭니다. 한 별자리 48개 별, 한 페이지에 24개 별자리까지 유지하며 페이지를 닫으면 종료됩니다.
- 완성된 별자리는 360도 방향과 서로 다른 거리의 3개 층(3.6 / 6.0 / 8.4m)에 남습니다. 바닥 링·근거리 입자와 헤드셋의 위치 추적으로 깊이·시차를 제공합니다. 자동 카메라 이동은 없습니다. 기존 도감 이름과 삽화를 재사용하며 완성된 별도 다시 집어 수정할 수 있습니다.
- 별·연결선 버퍼를 재사용하고, 손 관절은 외부 모델 다운로드 없이 점으로 표시합니다. 기존 웹캠 Worker와 2D 제작 화면은 그대로 사용합니다. 모바일 이야기 화면의 새 콘텐츠 연출은 보류 상태입니다.

검증: `node --test tests/vr.test.js tests/sky-selection.test.js tests/exhibition.test.js`, 개발 서버에서 `node tests/browser-vr.mjs`, `node tests/browser-occupied.mjs`, `node tests/browser-ar.mjs`. 합성 XR 관절·컨트롤러 입력, 손 유실·재개, 여러 작품·깊이·되돌리기, 최대 30개 선택, 중복 QR·동시 작성 방지를 검증합니다. 이 PC에는 실물 헤드셋이 연결되지 않아 Meta Quest의 입체 화면·실제 추적 감도는 기기에서 확인해야 합니다.

## Cloudflare D1 + Vercel 배포

### 현재 배포 (2026-10-17)

- 제작 화면: https://constellation-snowy-ten.vercel.app/
- 관람객 감상: https://constellation-snowy-ten.vercel.app/sky.html
- VR 작업 공간: https://constellation-snowy-ten.vercel.app/vr.html
- 인쇄/다른 노트북에 띄울 입장 QR: https://constellation-snowy-ten.vercel.app/entrance.html
- API: https://constellation-exhibition-api.minhyuk6512.workers.dev
- Vercel 프로젝트: `constellation` / Node 24 / Vite. Production 환경 변수 두 개에 위 공개 URL을 연결했습니다.
- D1: `constellation-exhibition`, APAC, ID `d32ad1df-9be5-4406-b0e3-db0a526d7623`. 운영 스키마 적용 완료.

로그인 없이 제작/감상/입장 페이지가 열리는 것을 확인했습니다. 실제 배포 주소에서 서로 다른 브라우저 세션으로 작성자 QR 생성 → 이야기 공개 → 좋아요·댓글 → PNG 저장을 검증했고, 그 검증에서 만든 작품과 연결 댓글·좋아요만 정리했습니다. 로컬 테스트 데이터는 운영 DB로 옮기지 않았습니다.

현재 Codex 인앱 브라우저의 제작 탭에는 운영자 키를 입력해 두었습니다. 다른 PC나 브라우저로 큰 화면을 운영할 때는 ‘전시 연결’에 로컬 `exhibition-secrets.local.json`의 `KIOSK_KEY`를 한 번 입력합니다. 이 파일은 비공개로 보관합니다. `SESSION_SECRET`은 운영자 화면에 입력하지 않습니다. 일반 관람객은 키가 필요 없습니다.

`.vercelignore`로 운영 키, `.env*`, 로컬 DB, Worker 설정을 프런트엔드 업로드에서 제외했습니다. 현재 작업 폴더의 코드를 CLI로 배포했으며, 추후 프런트 변경은 `npx vercel deploy --prod --scope minhyuks-projects-fdc1dca0`, API 변경은 아래 Worker 배포 명령으로 반영합니다.

### 구성과 재배포

Supabase·Neon은 사용하지 않습니다. DB는 **Cloudflare D1**, API는 **Cloudflare Worker**, 정적 사이트는 **Vercel**입니다. 클라우드 D1이 공유 원본이며 Vercel 함수의 임시 파일이나 관람객의 localStorage를 DB로 사용하지 않습니다. 브라우저에는 익명 방문 토큰과 운영 PC의 설정만 저장합니다. 좋아요는 익명 브라우저 토큰당 한 번이며 브라우저 저장소를 지우거나 다른 기기로 접속하면 별도 방문자로 취급됩니다.

2026-10-15 확인 기준 D1 무료 한도는 일일 읽기 500만 행·쓰기 10만 행·계정 총 저장 5GB입니다. Workers 무료 요청 한도도 별도로 적용됩니다. 무료 한도 초과 시 요청이 실패하므로 무제한이 아닙니다. [D1 공식 요금](https://developers.cloudflare.com/d1/platform/pricing/), [Workers 공식 요금](https://developers.cloudflare.com/workers/platform/pricing/). 하늘은 보이는 탭에서 10초마다 갱신합니다. 새 별자리가 추가돼도 기존 별의 위치와 카메라 방향은 유지합니다. 댓글은 사용자가 새로고침하거나 작성할 때 갱신합니다. 사용자별 댓글 6회/분, 좋아요 30회/분 제한을 둡니다. 결제 플랜 변경은 하지 않습니다.

로컬 구현과 테스트는 계정 없이 가능하지만 **실제 D1 생성과 Vercel 배포에는 각 서비스 로그인**이 필요합니다. 인증되지 않은 상태에서 생성·배포가 끝난 것으로 취급하지 않습니다.

1. Vercel에 이 프로젝트의 고정 Production 도메인을 준비하고 아래의 `your-project.vercel.app`을 그 주소로 바꿉니다. Preview 도메인을 입장 QR에 사용하지 않습니다.
2. Cloudflare 연결과 설정을 준비합니다.

```powershell
npx.cmd wrangler login
npm.cmd run exhibition:prepare -- https://your-project.vercel.app
# 처음 한 번만 생성. 기존 DB를 재사용한다면 해당 UUID를 production 설정의 DB에 연결합니다.
npx.cmd wrangler d1 create constellation-exhibition --config worker/wrangler.production.json --binding DB --update-config --location apac
```

생성된 설정을 한 번 더 정리하면 DB ID를 보존하면서 migration 경로를 자동 지정합니다. `binding`은 `DB`여야 합니다. 그다음:

```powershell
npm.cmd run exhibition:prepare -- https://your-project.vercel.app
npx.cmd wrangler d1 migrations apply DB --remote --config worker/wrangler.production.json
npx.cmd wrangler deploy --config worker/wrangler.production.json --secrets-file exhibition-secrets.local.json
```

`exhibition:prepare`는 운영자 키와 익명 세션 서명 키를 무작위 생성하고 재실행해도 기존 키를 보존합니다. 파일 `exhibition-secrets.local.json`, `.dev.vars*`, `.env*`, `.wrangler/`는 Git에서 제외합니다. **운영자 키·서명 키·Cloudflare 토큰은 VITE_ 환경 변수나 Git에 넣지 않습니다.** 개발용 키는 `worker/.dev.vars`에서만 사용하며 운영 설정에는 포함하지 않습니다.

3. 배포 결과 Worker 주소를 Vercel의 Production 환경 변수 `VITE_EXHIBITION_API_URL`에 지정합니다(예: `https://constellation-exhibition-api.<계정>.workers.dev`). `VITE_PUBLIC_SITE_URL`에는 고정 Vercel 도메인을 지정합니다. 두 값은 공개 URL입니다. Vercel 설정은 Vite, build `npm run build`, output `dist`, Node 24를 사용합니다. 저장소를 연결하거나 `npx vercel login` 후 `npx vercel --prod`로 배포합니다.
4. 큰 모니터의 사이트에서 ‘전시 연결’에 `exhibition-secrets.local.json`의 `KIOSK_KEY`를 입력합니다. 나머지 방문자는 키가 필요 없습니다. 현재 ‘연결 확인’은 서버/DB 가용성을 확인하며 운영자 키는 첫 작품 등록 때 검증됩니다.
5. HTTPS `entrance.html`의 입장 QR을 인쇄합니다. localhost QR은 관람객 휴대폰에서 열리지 않으므로 인쇄 화면에 안내가 표시됩니다.

전시 후 백업은 `npx wrangler d1 export DB --remote --config worker/wrangler.production.json --output tmp/exhibition-backup.sql`을 사용합니다. 공개 작품·댓글은 자동 삭제하지 않으며 초기화는 백업 후 운영자가 명시적으로 수행합니다. 이 초기 버전에는 운영자용 게시물 삭제 화면이 없습니다.

추가 구현 파일: `src/exhibition/`(API·작성자·감상·QR·3D 하늘), `worker/index.js`, `worker/migrations/0001_exhibition.sql`, `worker/wrangler.jsonc`, `sky.html`, `create.html`, `entrance.html`, `styles/exhibition.css`, `styles/kiosk.css`, `scripts/dev-exhibition.mjs`, `scripts/prepare-exhibition.mjs`, `vercel.json`. 기존 `src/main.js`에는 완성 이벤트와 QR 연결만 추가했습니다.

테스트: `npm test`는 SQLite의 실제 쿼리 실행, 등록 재시도·동시 슬롯 배정·한 번만 작성·브라우저별 좋아요·댓글 길이·속도 제한·손 선택/교차/유실을 검증합니다. `npm run test:exhibition`은 로컬 DB에 테스트 작품을 남기는 브라우저 통합 테스트입니다. 전시 운영 DB를 대상으로 실행하지 않습니다. 실제 휴대폰에서는 카메라 허용/거부, iOS 방향 권한, 화면 회전, 두 기기에서 동일 작품 확인, 모니터 앞 여러 사람의 교차 동작을 추가 확인합니다.

## 지금 사용할 수 있는 기능

- ESO의 실제 은하수 파노라마, 여러 깊이에 배치한 Three.js 별 9,500개, 성운 셰이더, 별빛 명멸.
- 별 생성·이동·연결·선택 삭제·되돌리기. 최대 48개이며 자동 인식이 배치한 별의 좌표를 변경하지 않습니다.
- **황도 12궁을 포함한 공식 88개 별자리**와 상상의 모양 112개(기존 12개 + 창작 100개), 총 **200종 도감**. 양·황소·쌍둥이·게·사자·처녀·천칭·전갈·궁수·염소·물병·물고기자리가 생일 구간과 함께 첫 탭에 표시됩니다. 한글·영문·IAU 약자·별칭 검색과 하늘별 필터를 제공합니다.
- 추가 창작 100종은 로켓·자전거·악기·식물·일상 사물·음식 등 서로 다른 소재입니다. 별 배치는 기존 Lucide 도안을 바탕으로 구성하고, 삽화는 기존 생성 삽화와 같은 금빛 세공·남색·은빛 질감과 입체 음영으로 별도 제작했습니다. 공식 천문 별자리로 표기하지 않습니다. 투명 PNG atlas 7장에 100개 그림을 담으며 `src/data/imagined/artwork.json`이 항목별 그림을 연결합니다. 생성 프롬프트는 `src/data/imagined/illustration-prompts.json`에 보관합니다. `src/data/imagined/seeds.js` 편집 후 `npm run catalogue:imagined`를 실행하면 좌표를 재생성하되 완성 삽화는 보존합니다. 실행 중 생성이나 추가 라이브러리 다운로드는 없습니다. 별 최소 간격과 전체 도감에 대한 회전·반사 유사도를 테스트합니다.
- 모든 별자리에 개별 좌표·연결선·이야기·삽화를 연결했습니다. 도감 미리보기에서도 실제 연결 모양을 확인할 수 있습니다. 불러오기는 현재 그림을 교체하며 이전 별자리의 별이 누적되지 않습니다. 기존 4개 별자리의 수동 배치와 삽화 크기 설정을 보존했고, 새 84개 투영은 가까운 별 간격을 벌려 구분할 수 있게 했습니다.
- 3.2초 정지 후 형태 비교. 마지막에 움직인 별을 기준으로, 별에서 별로 실제로 그려지듯 한 번에 한 구간씩 자라나며 한 방향으로 이어지고, 뒤이어 형태에 대응하는 삽화가 천천히 밝아집니다. 삽화는 항상 연결된 별 모양보다 크게 유지되며, 별 배치가 아주 넓어지면 카메라가 뒤로 물러나는 듯한 연출로 삽화 크기 자체는 일정하게 유지합니다. 별을 다시 움직이면 이전 연결선은 서서히 사라집니다. 수동 ‘형태 발견하기’와 자동 인식 끄기도 지원합니다.
- 웹캠에서 최대 두 손을 검출하되 중앙에서 손바닥을 1초 펼쳐 선택된 **한 손만 편집**합니다. 엄지·검지 집기 → 별 이동, 주먹 1초 → 별 생성, 손 펼치기 → 빛의 파동, 잡은 별을 좌우로 빠르게 흔들기 → 별 삭제. 손을 잃으면 잡던 별을 놓고 중복 생성을 방지합니다.
- 카메라 권한 거부·연결 실패 안내, 카메라 켜기/끄기. 영상은 브라우저 안에서 처리하며 서버 전송·녹화·화면 노출을 하지 않습니다.
- 별자리 PNG 저장, 이 브라우저에 최근 16개 작품 보관 및 복원, 밝기·삽화 선명도·품질 설정, 모바일 터치, 움직임 줄이기, UI를 숨기는 몰입 모드.
- 전시 연결 후 직접 편집한 형태가 발견되거나 도감에서 별자리를 선택하면 오른쪽에 작성자 QR을 표시합니다. 별자리를 먼저 만든 뒤 전시 연결을 해도 현재 작품의 QR을 발급합니다. 첫 화면의 안내 예시는 자동 등록하지 않습니다. 자유로운 배치는 ‘QR 공유’로 직접 등록할 수도 있습니다. 작성자가 닉네임·이야기를 남겨야 공개됩니다. 예전 이미지 공유 URL(`share.html#d=...`)과 PNG 저장 기능도 유지합니다.
- MoveNet MultiPose로 여러 관람객을 동시에 인식(다인원 포즈 추정). 추론은 별도 Worker에서 CPU 백엔드로 실행해 Three.js 렌더링·손 인식과 자원을 다투지 않습니다. 손 제스처 없이 지나가기만 해도 별의 발자취가 남고, 가까이 머무는 방문객들 사이에는 은하 다리가 이어지며, 한 사람이 한자리에 오래 머물면 그 사람의 자세를 따라 별이 잠시 모여듭니다(화면 번쩍임 없음 — VR 사용을 고려했습니다). 손 인식과 같은 카메라 스트림을 공유하며 별도 권한 요청은 없습니다.
- 형태 발견 시 짧은 셔터음이 나고, 정각마다 화면 곳곳이 잠깐 폭발했다 가라앉는 연출이 있습니다(화면 번쩍임 없이 별 이펙트만, ‘고요한 화면’ 설정 시 꺼짐). 상시 앰비언트 사운드는 현재 비어 있습니다 — 직접 채워 넣을 수 있도록 `src/audio/Soundscape.js`의 `toggle()` 안에 연결 지점을 주석으로 표시해 두었습니다.
- ‘나의 기록’에서 ‘타임랩스로 다시 보기’로 지금까지 저장된 별자리를 오래된 순서로 자동 재생합니다.
- 상단의 ‘AI가 하는 일’ 버튼에서 실제 인식 모델과 이 프로젝트가 직접 만든 해석 로직을 구분해 설명합니다. 심사·관람객 질의응답에서 AI 투명성을 짧게 보여주기 위한 패널입니다.

| 조작 | 마우스 / 키보드 |
| --- | --- |
| 별 생성 | 빈 공간 클릭 또는 터치, `A` 도구 |
| 이동 | 별 드래그, `V` 도구 |
| 연결 / 연결 해제 | `C` 도구에서 별 두 개 클릭 |
| 삭제 | 별 선택 후 `Delete` / `Backspace`, 또는 드래그 중 좌우로 빠르게 흔들기 |
| 되돌리기 | `Ctrl+Z` / `Cmd+Z` |
| 형태 발견 | `Enter` 또는 버튼 |
| 몰입 모드 | `H`, `Esc`로 돌아오기 |

## 파일 구조

```text
index.html                         화면의 의미 구조와 대화상자
share.html                        QR로 열리는 별자리 저장 전용 페이지
styles/main.css                    우주 화면·도구·반응형 스타일
styles/panels.css                  도감·설정·기록·QR 스타일
styles/share.css                   공유 페이지 전용 스타일
src/main.js                       기능 조립과 앱 흐름
src/share-main.js                 공유 페이지 렌더링과 저장
src/config.js                     제한값·타이밍
src/scene/Universe.js              Three.js 장면·레이어·그림·PNG 캡처·다인원 잔상
src/scene/shaders.js               은하수·성운·별빛·삽화 셰이더
src/interaction/CanvasModel.js     별·사용자 연결선·히스토리 상태
src/interaction/PointerController.js 마우스·터치
src/interaction/HandController.js  카메라 수명·손 슬롯·제스처 동작
src/interaction/HandMotion.js      One Euro 필터·데드존·손 좌표 렌더 보간
src/interaction/PoseController.js  MoveNet 다인원 포즈 추적·정지 판정·다리 연결
src/interaction/gestures.js        손 크기로 정규화한 제스처 분류
src/interaction/hand.worker.js     MediaPipe 추론 전용 Worker
src/interaction/pose.worker.js     MoveNet 추론 전용 Worker(CPU 백엔드)
src/recognition/matcher.js         회전·반전·크기 보정 및 형태 비교
src/recognition/recognition.worker.js 형태 비교 전용 Worker
src/data/shapes.js                 별자리·사물 좌표와 그림 매핑
src/data/constellations/catalogue.json  88개 별자리의 천체 참조 좌표·화면 좌표·연결선
src/data/constellations/stories.js  88개 이야기·황도 12궁 생일 구간·하늘 분류
src/data/constellations/sources.json  좌표·삽화의 원본 URL과 라이선스 기록
src/data/art.js                    다중 atlas·개별 삽화 매핑과 크레딧
src/data/archive.js                로컬 기록 검증·저장
src/data/share.js                  QR 공유용 압축 인코딩·디코딩(개인정보 미포함)
src/ui/Interface.js                도감·설정·안내·키보드·접근성
src/audio/Soundscape.js            앰비언트 사운드·별빛 음향
src/vendor/mediapipe-pose-stub.js  BlazePose 미사용 경로를 위한 빌드용 스텁
public/art/                       실제 은하수 사진·생성 삽화 atlas
scripts/setup-vision.mjs           로컬 모델·ES module WASM·포즈 모델 준비
scripts/import-constellations.mjs  별자리 자료 투영·중복 제거·간격 보정·삽화 다운로드
tests/                            회귀 테스트·브라우저 검증
```

## 형태 인식의 범위와 확장

손의 21개 관절 추적에는 **MediaPipe의 학습 모델**을 사용합니다. 별 배치 해석은 **200종 도감 중 별이 4개 이상인 템플릿의 기하학적 비교**입니다. 2~3개 별만 가진 별자리는 구분이 모호하므로 도감에서 직접 불러와 감상·저장·QR 공유할 수 있습니다. 임의의 모든 현실 사물을 알아보는 범용 이미지 AI나 실행 중 새 삽화를 생성하는 기능은 아닙니다.

배치 순서에 영향을 받지 않는 양방향 최근접 거리, 별 개수, 32개 회전 방향, 좌우 반전, 각도 세부 탐색을 사용합니다. 표시하는 ‘형태 유사도’는 이 거리에서 산출한 지표로, 보정된 확률이나 과학적인 신뢰도는 아닙니다. 낮은 유사도에서는 이름·삽화를 확정하지 않고 사용자 배치를 유지합니다. 별이 적거나 배치가 모호하면 여러 형태가 비슷하게 평가될 수 있습니다. 직접 연결한 선은 보존하고, 자동 생성한 선은 다음 편집 때 교체합니다.

새 모양은 `src/data/shapes.js`에 좌표·연결·삽화 매핑을 추가해 확장할 수 있습니다. 더 넓은 사물 인식에는 별도 학습 데이터 또는 비전 모델과 삽화 공급 방식이 필요합니다. 모바일 감상은 방향 센서와 카메라를 사용하며 WebXR/VR 세션이나 공간 앵커는 구현하지 않았습니다. 렌더러·편집 상태·입력은 분리되어 있습니다.

기존 단일 파일이 실험하던 몸 전체 포즈 추정은 `src/interaction/PoseController.js`로 이식해 다인원 인식(최대 6명)으로 되살렸습니다. MoveNet MultiPose Lightning을 `src/interaction/pose.worker.js`에서 CPU 백엔드로 실행하며(WebGL 백엔드는 Three.js 렌더러와 GPU를 다퉈 메인 스레드가 눈에 띄게 밀리는 원인이었습니다), 사람별 정지 시간·이동 속도로 ‘머무름’과 ‘지나감’을 구분합니다 — 손 제스처 인식(`HandController`, MediaPipe, CPU 델리게이트 Worker)과는 독립된 워커·경로이지만 카메라 스트림은 하나만 공유합니다. 이 다인원 레이어는 관람객이 직접 만든 별(`CanvasModel`)에는 관여하지 않는, 배경에 가까운 별도의 잔상 레이어(`Universe.js`의 presence 레이어)입니다. 손동작 실험 파일 `hand-test.html`은 그대로 보존했습니다.

기획서(`plan.html`)의 ‘중간 버전’ 중 SelfieSegmentation(픽셀 단위 실루엣)과 Teachable Machine 커스텀 제스처 학습은 이번에 도입하지 않았습니다. 실루엣의 연출 목적은 MoveNet의 17개 관절점으로 이미 충분히 전달되고, 제스처는 이미 검증된 규칙 기반 분류기(`src/interaction/gestures.js`)가 안정적으로 동작하고 있어 — 새 모델을 얹기보다 현재 있는 것으로 서사를 채우는 쪽을 택했습니다. 현장에서 커스텀 제스처가 꼭 필요해지면 그때 판단하는 편이 낫습니다.

MediaPipe의 배포 WASM 로더는 classic script를 전제로 합니다. 준비 스크립트는 원본을 수정하지 않고 `ModuleFactory`를 export하는 `.mjs` 사본을 만들어 module Worker에서 불러옵니다. 디버그 훅도 제공해 strict ESM에서 블록 함수 스코프 문제가 생기지 않도록 했습니다.

## 출처

- 은하수: **[ESO/S. Brunier — The Milky Way panorama](https://www.eso.org/public/images/eso0932a/)**. [CC BY 4.0 및 ESO 사용 조건](https://www.eso.org/public/outreach/copyright/). 화면과 저장 이미지에 크레딧을 표시합니다. 화면에서는 색조·밝기·기울기를 조정했습니다.
- 별자리 좌표·한글 이름: [d3-celestial](https://github.com/ofrohn/d3-celestial), BSD 3-Clause. 원문 라이선스는 `src/data/constellations/DATA-LICENSE.txt`와 빌드에 포함되는 `public/art/constellations/DATA-LICENSE.txt`에 보관했습니다. 구면 좌표를 접평면에 투영하고 가까운 별의 표시 간격을 보정했습니다. 큰곰은 기존 북두칠성 부분을 유지하며, 뱀자리는 머리·꼬리 두 영역을 하나의 항목으로 묶되 사이에 가짜 연결선을 추가하지 않습니다.
- 32종 생성 삽화: 기존 16종 atlas와 새 16종 `zodiac-atlas.png`. 새 atlas는 양자리를 제외한 11궁과 뱀·고물·돛·안드로메다·페가수스 그림을 담습니다. 실시간 생성이 아닌 사전 제작 아트입니다.
- 추가 창작 100종의 삽화는 내장 image_gen으로 사전 제작한 PNG atlas입니다. 별 배치의 기하 도안은 이미 사용 중인 Lucide 0.468.0을 바탕으로 재구성했으며 Lucide Contributors / ISC 고지는 `public/art/imagined/LICENSE.txt`에 보관합니다. 기존 삽화나 공식 별자리의 좌표를 복제하지 않습니다.
- 나머지 68종 삽화: **[Johan Meuris / Stellarium](https://johanmeuris.eu/work/stellarium-constellation-art/)**, **[Free Art License 1.3](https://artlibre.org/licence/lal/en/)**. 원본 PNG는 수정하지 않았고 렌더링할 때 색조·투명도·크기를 조정합니다. 라이선스 고지는 `public/art/constellations/LICENSE.txt`, 파일별 원본 주소는 `src/data/constellations/sources.json`에 있습니다. 해당 삽화는 재배포·파생 작품에도 이 라이선스와 크레딧을 유지해야 합니다. 도감·그림 설명·PNG 저장에 출처를 표시합니다.
- [Three.js](https://threejs.org/) (MIT), [Lucide](https://lucide.dev/) (ISC), [MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js) (Apache-2.0), [TensorFlow.js MoveNet MultiPose](https://www.tensorflow.org/hub/tutorials/movenet) (Apache-2.0), [qrcode](https://github.com/soldair/node-qrcode) (MIT).
