# Constellation — 별로 그리는 사람

`D:\GitHub\constellation`의 기존 Three.js 데모를 기능별 모듈로 분리한 웹캠 인터랙티브 미디어아트입니다. 기존 `plan.html`, `hand-test.html`, `panel.html`, 작품설명서 파일은 보존했습니다.

## 실행

Node.js **20.19 이상(20.x)** 또는 **22.12 이상**이 필요합니다.

```powershell
cd D:\GitHub\constellation
npm.cmd install
npm.cmd run dev
```

터미널에 표시된 주소(기본 `http://127.0.0.1:5173`)를 엽니다. Windows PowerShell 실행 정책에 영향을 받지 않도록 `npm.cmd`를 표기했습니다. 다른 셸에서는 `npm`을 사용해도 됩니다. `index.html` 더블클릭이나 기존 단순 정적 서버 대신 Vite 개발 서버로 실행합니다.

최초 설치 시 MediaPipe 손 인식 모델·WASM과 MoveNet MultiPose(다인원 포즈) 모델을 `public/models`, `public/wasm`에 준비합니다. 설치 후 앱 실행과 인식에는 외부 API나 키가 필요하지 않습니다. 생성되는 모델·WASM은 Git에서 제외했으며, 다운로드가 실패했다면 `npm.cmd run setup:vision`을 다시 실행합니다.

```powershell
npm.cmd test          # 형태 인식·편집·손짓 분류 검증
npm.cmd run build     # 배포용 dist 생성
npm.cmd run preview   # 빌드 결과 로컬 확인
npm.cmd run test:browser
```

브라우저 검증은 개발 서버가 실행된 상태에서 별도로 실행합니다. Windows에 설치된 Chrome/Edge를 사용하며, 다른 환경에서는 `CHROME_PATH` 환경 변수로 브라우저 실행 파일을 지정하거나 `npx playwright install chromium`으로 준비합니다. `TEST_URL`로 미리보기 서버 주소를 지정할 수 있습니다. 이 테스트는 **가상 카메라**로 모델 로딩과 추론을 확인합니다. 실제 웹캠의 조명·거리·손짓 감도는 현장에서 별도로 확인해야 합니다.

## 지금 사용할 수 있는 기능

- ESO의 실제 은하수 파노라마, 여러 깊이에 배치한 Three.js 별 9,500개, 성운 셰이더, 별빛 명멸.
- 별 생성·이동·연결·선택 삭제·되돌리기. 최대 48개이며 자동 인식이 배치한 별의 좌표를 변경하지 않습니다.
- 양자리, 카시오페아, 오리온, 큰곰(북두칠성)과 하트, 별, 초승달, 국화, 고양이, 나비, 물고기, 나무, 집, 자동차, 우산, 똥 모양의 총 16가지 도감.
- 3.2초 정지 후 형태 비교, 연결선 순차 표시, 형태에 대응하는 은은한 삽화. 수동 ‘형태 발견하기’와 자동 인식 끄기도 지원합니다.
- 웹캠으로 두 손 추적: 엄지·검지 집기 → 별 이동, 주먹 1초 → 별 생성, 손 펼치기 → 빛의 파동. 손을 잃으면 잡던 별을 놓고 중복 생성을 방지합니다.
- 카메라 권한 거부·연결 실패 안내, 카메라 켜기/끄기. 영상은 브라우저 안에서 처리하며 서버 전송·녹화·화면 노출을 하지 않습니다.
- 별자리 PNG 저장, 이 브라우저에 최근 16개 작품 보관 및 복원, 앰비언트 사운드, 밝기·삽화 선명도·품질 설정, 모바일 터치, 움직임 줄이기, UI를 숨기는 몰입 모드.
- ‘QR 공유’로 지금 그린 별자리를 QR 코드로 표시. 휴대폰으로 스캔하면 별의 위치·연결선만으로 그린 이미지를 그 자리에서 저장할 수 있습니다(`share.html`). 영상·이름 등 개인정보는 전달되지 않습니다.
- MoveNet MultiPose로 여러 관람객을 동시에 인식(다인원 포즈 추정). 손 제스처 없이 지나가기만 해도 별의 발자취가 남고, 가까이 머무는 방문객들 사이에는 은하 다리가 이어지며, 한 사람이 한자리에 오래 머물면 그 사람의 자세를 따라 별이 잠시 모여듭니다. 손 인식과 같은 카메라 스트림을 공유하며 별도 권한 요청은 없습니다.

| 조작 | 마우스 / 키보드 |
| --- | --- |
| 별 생성 | 빈 공간 클릭 또는 터치, `A` 도구 |
| 이동 | 별 드래그, `V` 도구 |
| 연결 / 연결 해제 | `C` 도구에서 별 두 개 클릭 |
| 삭제 | 별 선택 후 `Delete` / `Backspace` |
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
src/interaction/PoseController.js  MoveNet 다인원 포즈 추적·정지 판정·다리 연결
src/interaction/gestures.js        손 크기로 정규화한 제스처 분류
src/interaction/hand.worker.js     MediaPipe 추론 전용 Worker
src/recognition/matcher.js         회전·반전·크기 보정 및 형태 비교
src/recognition/recognition.worker.js 형태 비교 전용 Worker
src/data/shapes.js                 별자리·사물 좌표와 그림 매핑
src/data/archive.js                로컬 기록 검증·저장
src/data/share.js                  QR 공유용 압축 인코딩·디코딩(개인정보 미포함)
src/ui/Interface.js                도감·설정·안내·키보드·접근성
src/audio/Soundscape.js            앰비언트 사운드·별빛 음향
src/vendor/mediapipe-pose-stub.js  BlazePose 미사용 경로를 위한 빌드용 스텁
public/art/                       실제 은하수 사진·생성 삽화 atlas
scripts/setup-vision.mjs           로컬 모델·ES module WASM·포즈 모델 준비
tests/                            회귀 테스트·브라우저 검증
```

## 형태 인식의 범위와 확장

손의 21개 관절 추적에는 **MediaPipe의 학습 모델**을 사용합니다. 별 배치 해석은 **등록된 16개 템플릿의 기하학적 비교**입니다. 임의의 모든 현실 사물을 알아보는 범용 이미지 AI나 실행 중 새 삽화를 생성하는 기능은 아닙니다.

배치 순서에 영향을 받지 않는 양방향 최근접 거리, 별 개수, 32개 회전 방향, 좌우 반전, 각도 세부 탐색을 사용합니다. 표시하는 ‘형태 유사도’는 이 거리에서 산출한 지표로, 보정된 확률이나 과학적인 신뢰도는 아닙니다. 낮은 유사도에서는 이름·삽화를 확정하지 않고 사용자 배치를 유지합니다. 별이 적거나 배치가 모호하면 여러 형태가 비슷하게 평가될 수 있습니다. 직접 연결한 선은 보존하고, 자동 생성한 선은 다음 편집 때 교체합니다.

새 모양은 `src/data/shapes.js`에 좌표·연결·삽화 매핑을 추가해 확장할 수 있습니다. 더 넓은 사물 인식에는 별도 학습 데이터 또는 비전 모델과 삽화 공급 방식이 필요합니다. WebXR/VR은 아직 구현하지 않았습니다. 추후 공간 입력 컨트롤러와 XR 렌더링을 연결할 수 있게 렌더러·편집 상태·입력을 분리했습니다.

기존 단일 파일이 실험하던 몸 전체 포즈 추정은 `src/interaction/PoseController.js`로 이식해 다인원 인식(최대 6명)으로 되살렸습니다. MoveNet MultiPose Lightning을 메인 스레드에서 실행하며, 사람별 정지 시간·이동 속도로 ‘머무름’과 ‘지나감’을 구분합니다 — 손 제스처 인식(`HandController`, MediaPipe, CPU 델리게이트 Worker)과는 독립된 경로이지만 카메라 스트림은 하나만 공유합니다. 이 다인원 레이어는 관람객이 직접 만든 별(`CanvasModel`)에는 관여하지 않는, 배경에 가까운 별도의 잔상 레이어(`Universe.js`의 presence 레이어)입니다. 손동작 실험 파일 `hand-test.html`은 그대로 보존했습니다.

MediaPipe의 배포 WASM 로더는 classic script를 전제로 합니다. 준비 스크립트는 원본을 수정하지 않고 `ModuleFactory`를 export하는 `.mjs` 사본을 만들어 module Worker에서 불러옵니다. 디버그 훅도 제공해 strict ESM에서 블록 함수 스코프 문제가 생기지 않도록 했습니다.

## 출처

- 은하수: **[ESO/S. Brunier — The Milky Way panorama](https://www.eso.org/public/images/eso0932a/)**. [CC BY 4.0 및 ESO 사용 조건](https://www.eso.org/public/outreach/copyright/). 화면과 저장 이미지에 크레딧을 표시합니다. 화면에서는 색조·밝기·기울기를 조정했습니다.
- 별자리 참조: 기존 데모의 [d3-celestial](https://github.com/ofrohn/d3-celestial) 기반 투영을 참고했습니다. 천체 관측용 좌표계가 아닌 예술적 화면 배치이며, 큰곰은 북두칠성 부분을 보여줍니다.
- 16종 삽화: 이 프로젝트를 위해 생성한 별도 이미지. 실시간 AI 생성이 아닌 사전 제작 아트입니다.
- [Three.js](https://threejs.org/) (MIT), [Lucide](https://lucide.dev/) (ISC), [MediaPipe Hand Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js) (Apache-2.0), [TensorFlow.js MoveNet MultiPose](https://www.tensorflow.org/hub/tutorials/movenet) (Apache-2.0), [qrcode](https://github.com/soldair/node-qrcode) (MIT).
