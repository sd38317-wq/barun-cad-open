// 별지 제3호서식: 구조 엔진의 결과를 옮긴다. 구조 계산·법정 확인·서명은 수행하지 않는다.
// 아래 TEMPLATES는 docs/structure/forms/별지제3호서식_*.txt [표-B]의 셀 좌표·원문,
// 같은 폴더 HWP의 셀 폭 비율을 전사했다(제1·3·5장만). 런타임에 원본/엔진을 읽지 않는다.
const TEMPLATES = {"rc":{"chapter":1,"columnWidths":[29.22301,29.86752,10.48507,2.22434,11.67977,20.0191,20.61645,12.50506,1.4698,10.00955,1.11217,8.94061,27.84754],"rowHeights":[4.8,8,5.52097,5.52097,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.2,10.16706,5.52097,5.52097,5.52097,8.05039,4.52261,4.52261,4.52261,4.52261,8.05039,4.52261,4.52261,5.52097,5.52097,5.52097,4.52261,9.10872,4.52261,4.52261,5.52097,5.52097,5.52097,8.05039,4.52261,23,4],"cells":[[0,0,1,11,"■ 건축물의 구조기준 등에 관한 규칙 [별지 제3호서식] <개정 2020. 2. 12.>"],[0,11,1,2,"(제1장)"],[1,0,1,13,"구조안전 및 내진설계 확인서(소규모건축물-콘크리트구조)"],[2,0,1,1,"1) 공사명"],[2,1,1,12,""],[3,0,1,1,"2) 대지위치"],[3,1,1,12,""],[4,0,3,1,"3) 규모"],[4,1,1,1,"지상 2층 층고"],[4,2,1,5,"m"],[4,7,1,3,"층수"],[4,10,1,3,"지하()층/지상()층"],[5,1,1,1,"지상 1층 층고"],[5,2,1,5,"m"],[5,7,2,3,"연면적"],[5,10,2,3,"m2"],[6,1,1,1,"지하층 층고"],[6,2,1,5,"m"],[7,0,1,1,"4) 용도"],[7,1,1,9,"주거 시설( ) / 근린생활 시설( )"],[7,10,9,3,"* 「소규모건축구조기준」참조"],[8,0,1,1,"5) 구조형식"],[8,1,1,9,"횡구속골조( ) / 비횡구속골조( )"],[9,0,8,1,"6) 적용제한"],[9,1,4,1,"설계 하중"],[9,2,1,5,"바닥 고정하중 초과 유무"],[9,7,1,3,"유 / 무"],[10,2,1,5,"바닥 활하중 초과 유무"],[10,7,1,3,"유 / 무"],[11,2,1,5,"적설하중 초과지역 해당"],[11,7,1,3,"유 / 무"],[12,2,1,5,"풍하중 초과지역 해당"],[12,7,1,3,"유 / 무"],[13,1,4,1,"구조 계획"],[13,2,1,5,"수직부재 불연속"],[13,7,1,3,"유 / 무"],[14,2,1,5,"1,2층 구조형식 동일성"],[14,7,1,3,"유 / 무"],[15,2,2,5,"캔틸레버보"],[15,7,1,3,"유 / 무"],[16,7,1,1,"길이"],[16,8,1,2,"m"],[16,10,1,3,"*최대 1.5m 이하"],[17,0,3,1,"7) 평면 계획"],[17,1,1,1,"평면 크기"],[17,2,1,3,"가로길이: \n 세로길이:"],[17,5,1,5,"m \n m"],[17,10,1,3,"*가로 세로 비율 1:5 이하"],[18,1,1,1,"기둥경간"],[18,2,1,2,"최대"],[18,4,1,3,"m,"],[18,7,1,2,"최소"],[18,9,1,4,"m"],[19,1,1,1,"보 배치간격"],[19,2,1,2,"최대"],[19,4,1,3,"m,"],[19,7,1,2,"최소"],[19,9,1,4,"m"],[20,0,1,1,"8) 재료 강도"],[20,1,1,1,"콘크리트"],[20,2,1,1,"fck="],[20,3,1,4,"MPa"],[20,7,1,3,"철근"],[20,10,1,2,"fy="],[20,12,1,1,"MPa"],[21,0,1,1,"9) 슬래브"],[21,1,1,1,"단변방향 최대경간"],[21,2,1,5,"m"],[21,7,1,3,"두께"],[21,10,1,3,"mm"],[22,0,5,1,"10) 보"],[22,1,2,1,"구분"],[22,2,2,5,"최대경간(m)"],[22,7,1,6,"단면크기(mm)"],[23,7,1,3,"폭"],[23,10,1,3,"깊이"],[24,1,1,1,"작은보"],[24,2,1,5,""],[24,7,1,3,""],[24,10,1,3,""],[25,1,1,1,"큰보"],[25,2,1,5,""],[25,7,1,3,""],[25,10,1,3,""],[26,1,1,1,"작은보를 지지하는 큰보"],[26,2,1,5,""],[26,7,1,3,""],[26,10,1,3,""],[27,0,5,1,"11) 기둥"],[27,1,2,6,"최대누적부하면적(m2)"],[27,7,1,6,"단면크기(mm)"],[28,7,1,3,"폭"],[28,10,1,3,"깊이"],[29,1,1,1,"2층 기둥"],[29,2,1,5,""],[29,7,1,3,""],[29,10,1,3,""],[30,1,1,1,"1층 기둥"],[30,2,1,5,""],[30,7,1,3,""],[30,10,1,3,""],[31,1,1,1,"지하층 기둥"],[31,2,1,5,""],[31,7,1,3,""],[31,10,1,3,""],[32,0,2,1,"12) 기초"],[32,1,1,6,"매립지역/연약한 토사지반 해당 유무"],[32,7,1,6,"유 / 무"],[33,1,1,6,"기초형식/두께"],[33,7,1,6,"기둥하부:        /     \n 벽체하부:        /"],[34,0,4,1,"13) 전단벽"],[34,1,2,1,"배치 방향"],[34,2,1,8,"총 벽체길이(m)"],[34,10,2,3,"벽체두께(mm)"],[35,2,1,4,"1층"],[35,6,1,4,"2층"],[36,1,1,1,"가로 방향"],[36,2,1,4,""],[36,6,1,4,""],[36,10,1,3,""],[37,1,1,1,"세로 방향"],[37,2,1,4,""],[37,6,1,4,""],[37,10,1,3,""],[38,0,2,1,"14) 비구조요소"],[38,1,1,1,"건축비구조요소"],[38,2,1,8,""],[38,10,2,3,"공사단계에서 확인이 필요한 비구조요소 기재"],[39,1,1,1,"기계ㆍ전기 비구조요소"],[39,2,1,8,""],[40,0,1,1,"15) 특이사항"],[40,1,1,12,""],[41,0,1,13,"「건축법」 제48조 및 같은 법 시행령 제32조에 따라 건축물의 구조안전 및 내진설계 확인서를 제출합니다. \n  년    월    일 \n 작성자(설계자):           (인) \n 주소:                                      / 연락처:"],[42,0,1,13,"210㎜×297㎜[백상지(80g/㎡)]"]]},"steel":{"chapter":3,"columnWidths":[35.89605,29.23873,1.74096,11.12172,1.11217,14.46217,29.99721,1.22614,10.9213,3.33652,9.80912,5.81631,4.24826,27.07334],"rowHeights":[4.8,8,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,9.10872,11.57817,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,4.52261,9.10872,4.52261,4.52261,4.52261,4.52261,4.52261,10.16706,4.52261,8.70656,4.52261,23,4],"cells":[[0,0,1,14,"■ 건축물의 구조기준 등에 관한 규칙 [별지 제3호서식]                                                      (제3장)"],[1,0,1,14,"구조안전 및 내진설계 확인서(소규모건축물-강구조)"],[2,0,1,1,"1) 공사명"],[2,1,1,13,""],[3,0,1,1,"2) 대지위치"],[3,1,1,13,""],[4,0,3,1,"3) 규모"],[4,1,1,2,"지상 2층 층고"],[4,3,1,5,"m"],[4,8,1,3,"층수"],[4,11,1,3,"지하()층/지상()층"],[5,1,1,2,"지상 1층 층고"],[5,3,1,5,"m"],[5,8,2,3,"연면적"],[5,11,2,3,"m2"],[6,1,1,2,"지하층 층고"],[6,3,1,5,"m"],[7,0,1,1,"4) 용도"],[7,1,1,10,"주거 시설( ) / 근린생활 시설( )"],[7,11,9,3,"* 「소규모건축구조기준」 참조"],[8,0,1,1,"5) 구조형식"],[8,1,1,10,"횡구속골조( ) / 비횡구속골조( )"],[9,0,8,1,"6) 적용제한"],[9,1,4,2,"설계 하중"],[9,3,1,5,"바닥 고정하중 초과 유무"],[9,8,1,3,"유 / 무"],[10,3,1,5,"바닥 활하중 초과 유무"],[10,8,1,3,"유 / 무"],[11,3,1,5,"적설하중 초과지역 해당"],[11,8,1,3,"유 / 무"],[12,3,1,5,"풍하중 초과지역 해당"],[12,8,1,3,"유 / 무"],[13,1,4,2,"구조 계획"],[13,3,1,5,"수직부재 불연속"],[13,8,1,3,"유 / 무"],[14,3,1,5,"1,2층 구조형식 동일성"],[14,8,1,3,"유 / 무"],[15,3,2,5,"캔틸레버보"],[15,8,1,3,"유 / 무"],[16,8,1,2,"길이"],[16,10,1,1,"m"],[16,11,1,3,"*최대 1.5m 이하"],[17,0,3,1,"7) 평면 계획"],[17,1,1,2,"평면 크기"],[17,3,1,8,"가로길이:                     m \n 세로길이:                     m"],[17,11,1,3,"*가로 세로 비율 1:5 이하"],[18,1,1,2,"기둥경간"],[18,3,1,2,"최대"],[18,5,1,2,"m,"],[18,7,1,7,"*최대경간이 10m 이하 \n *8m 초과시 0604횡구속골조 설계 적용해야함"],[19,1,1,2,"보 배치간격"],[19,3,1,2,"최대"],[19,5,1,2,"m,"],[19,7,1,7,"*최대 3.5m 이하"],[20,0,2,1,"8) 지붕 구조"],[20,1,1,2,"구조 형식"],[20,3,1,11,"경량마감지붕 / 철근콘크리트지붕"],[21,1,1,2,"지붕 형태"],[21,3,1,11,"경사지붕 / 평지붕"],[22,0,2,1,"9) 재료 강도"],[22,1,1,2,"콘크리트"],[22,3,1,1,"fck="],[22,4,1,4,"MPa"],[22,8,1,3,"철근"],[22,11,1,2,"fy="],[22,13,1,1,"MPa"],[23,1,1,2,"강재"],[23,3,1,5,"규격:"],[23,8,1,1,"Fy="],[23,9,1,5,"MPa"],[24,0,1,1,"10) 지상층 슬래브"],[24,1,1,5,"단변방향 최대경간"],[24,6,1,2,"m"],[24,8,1,3,"두께"],[24,11,1,3,"mm"],[25,0,4,1,"11) 보"],[25,1,1,5,"구분"],[25,6,1,2,"최대경간(m)"],[25,8,1,6,"H형강 단면치수(mm)"],[26,1,1,5,"작은보"],[26,6,1,2,""],[26,8,1,6,""],[27,1,1,5,"큰보"],[27,6,1,2,""],[27,8,1,6,""],[28,1,1,5,"작은보를 지지하는 큰보"],[28,6,1,2,""],[28,8,1,6,""],[29,0,4,1,"12) 기둥"],[29,1,1,7,"부하면적(m2)"],[29,8,1,6,"최대 단면크기(mm)"],[30,1,1,5,"2층 기둥"],[30,6,1,2,""],[30,8,1,6,""],[31,1,1,5,"1층 기둥"],[31,6,1,2,""],[31,8,1,6,""],[32,1,1,5,"지하층 철근콘크리트 기둥"],[32,6,1,2,""],[32,8,1,6,""],[33,0,2,1,"13) 기초"],[33,1,1,7,"매립지역/연약한 토사지반 해당 유무"],[33,8,1,6,"유 / 무"],[34,1,1,5,"기초형식/두께"],[34,6,1,8,"기둥하부:                 /         \n 벽체하부:                 /"],[35,0,6,1,"14) 횡력 저항요소"],[35,1,3,1,"전단벽"],[35,2,3,4,"유 / 무"],[35,6,1,2,"배치방향"],[35,8,1,4,"가로방향"],[35,12,1,2,"세로방향"],[36,6,1,2,"층당 개소/총 길이"],[36,8,1,4,"개/   m"],[36,12,1,2,"개/    m"],[37,6,1,2,"벽체두께"],[37,8,1,4,"mm"],[37,12,1,2,"mm"],[38,1,2,1,"수직가새"],[38,2,2,4,"유 / 무"],[38,6,1,2,"층당 개소"],[38,8,1,4,"개"],[38,12,1,2,"개"],[39,6,1,2,"가새 각도"],[39,8,1,4,"도"],[39,12,1,2,"도"],[40,1,1,13,"* 수직가새 또는 전단벽 설치 기준은 0604.5 참조 \n  * 미설치시 0605 비횡구속골조의 설계 적용해야 함"],[41,0,2,1,"15) 비구조요소"],[41,1,1,1,"건축비구조요소"],[41,2,1,11,""],[41,13,2,1,"공사단계에서 확인이 필요한 비구조요소 기재"],[42,1,1,1,"기계ㆍ전기 비구조요소"],[42,2,1,11,""],[43,0,1,1,"16) 특이사항"],[43,1,1,13,""],[44,0,1,14,"「건축법」 제48조 및 같은 법 제32조에 따라 건축물의 구조안전 및 내진설계 확인서를 제출합니다. \n  년    월    일 \n 작성자(설계자):           (인) \n 주소:                                      / 연락처:"],[45,0,1,14,"210㎜×297㎜[백상지(80g/㎡)]"]]},"wood":{"chapter":5,"columnWidths":[16.54638,14.36028,12.32095,4.88203,7.36167,1.10077,4.6696,4.24088,10.61765,2.80022,3.95506,1.51405,5.80127,2.90836,7.14924,2.17451,1.64923,2.217,4.06321,7.26897,0.83041,6.43857,3.47227,1.15871,5.47297,4.70436,3.9512,3.27915,3.01651,1.06988,1.29003,0.28195,5.50774,1.2321,4.57304,5.28758,16.83219],"rowHeights":[4.76966,7.94944,4.17345,4.17345,4.17345,4.17345,4.17345,4.17345,4.17345,4.17345,4.17345,4.17345,4.17345,4.17345,4.17345,4.17345,4.17345,13.32083,8.41315,8.41315,4.17345,7.01096,7.01096,7.01096,7.01096,7.01096,7.01096,4.17345,7.01096,4.17345,4.17345,4.17345,4.17345,4.17345,4.17345,9.81535,9.81535,4.17345,7.71206,4.17345,4.17345,4.49753,8.70411,4.17345,22.85463,3.97472],"cells":[[0,0,1,29,"■ 건축물의 구조기준 등에 관한 규칙 [별지 제3호서식]"],[0,29,1,8,"(제5장)"],[1,0,1,37,"구조안전 및 내진설계 확인서(소규모건축물-목구조)"],[2,0,1,2,"1) 공사명"],[2,2,1,35,""],[3,0,1,2,"2) 대지위치"],[3,2,1,35,""],[4,0,3,2,"3) 규모"],[4,2,1,4,"지상 2층 층고"],[4,6,1,12,"m"],[4,18,1,8,"층수"],[4,26,1,11,"지하 1층/지상 2층"],[5,2,1,4,"지상 1층 층고"],[5,6,1,12,"m"],[5,18,2,8,"연면적"],[5,26,2,11,"m2"],[6,2,1,4,"지하층 층고"],[6,6,1,12,"m"],[7,0,1,2,"4) 용도"],[7,2,1,24,"주거 시설 (  ) / 근린생활 시설 (  )"],[7,26,9,11,"*「소규모 건축구조기준」 참조"],[8,0,1,2,"5) 구조형식"],[8,2,1,24,"경골목구조 (  ) / 중목구조 (  )"],[9,0,8,2,"6) 적용제한"],[9,2,4,4,"설계 하중"],[9,6,1,12,"바닥 고정하중 초과 유무"],[9,18,1,8,"유 / 무"],[10,6,1,12,"바닥 활하중 초과 유무"],[10,18,1,8,"유 / 무"],[11,6,1,12,"적설하중 초과지역 해당"],[11,18,1,8,"유 / 무"],[12,6,1,12,"풍하중 초과지역 해당"],[12,18,1,8,"유 / 무"],[13,2,4,4,"구조 계획"],[13,6,1,12,"수직부재 불연속"],[13,18,1,8,"유 / 무"],[14,6,1,12,"1,2층 구조형식 동일성"],[14,18,1,8,"유 / 무"],[15,6,2,12,"캔틸레버보"],[15,18,1,8,"유 / 무"],[16,18,1,4,"길이"],[16,22,1,4,"m"],[16,26,1,11,"* 최대 1.5m 이하"],[17,0,3,2,"7) 평면 계획"],[17,2,1,4,"평면 크기"],[17,6,1,10,"외접사각형 장변 길이 : \n 외접사각형 단변 길이 :"],[17,16,1,10,"m \n m"],[17,26,1,11,"* 장변 18m 이하 \n * 장변:단변 길이 비율 3:1 이하"],[18,2,1,4,"수직하중지지구조 간격"],[18,6,1,6,"최대"],[18,12,1,6,"m"],[18,18,1,8,""],[18,26,1,11,"* 6m 이하"],[19,2,1,4,"내력벽 사이 거리"],[19,6,1,6,"최대"],[19,12,1,6,"m"],[19,18,1,8,""],[19,26,1,11,"* 12m 이하"],[20,0,1,2,"8) 구조용 목재"],[20,2,1,4,"종류"],[20,6,1,4,""],[20,10,1,8,"수종"],[20,18,1,8,""],[20,26,1,7,"등급"],[20,33,1,4,""],[21,0,2,1,"9) 지붕"],[21,1,1,1,"서까래"],[21,2,1,4,"경간"],[21,6,1,4,"m"],[21,10,1,8,"단면치수  \n (mmxmm)"],[21,18,1,8,""],[21,26,1,7,"적용 경간표"],[21,33,1,4,""],[22,1,1,1,"덮개"],[22,2,1,4,"종류"],[22,6,1,4,""],[22,10,1,8,"두께"],[22,18,1,8,"mm"],[22,26,1,7,"못박기 간격"],[22,33,1,4,"mm"],[23,0,2,1,"10) 천장"],[23,1,1,1,"장선"],[23,2,1,4,"경간"],[23,6,1,4,"m"],[23,10,1,8,"단면치수 \n (mmxmm)"],[23,18,1,8,""],[23,26,1,7,"적용 경간표"],[23,33,1,4,""],[24,1,1,1,"덮개"],[24,2,1,4,"종류"],[24,6,1,4,""],[24,10,1,8,"두께"],[24,18,1,8,"mm"],[24,26,1,7,"못박기 간격"],[24,33,1,4,"mm"],[25,0,2,1,"11) 바닥"],[25,1,1,1,"장선"],[25,2,1,4,"경간"],[25,6,1,4,"m"],[25,10,1,8,"단면치수 \n (mmxmm)"],[25,18,1,8,""],[25,26,1,7,"적용 경간표"],[25,33,1,4,""],[26,1,1,1,"덮개"],[26,2,1,4,"종류"],[26,6,1,4,""],[26,10,1,8,"두께"],[26,18,1,8,"mm"],[26,26,1,7,"못박기 간격"],[26,33,1,4,"mm"],[27,0,6,2,"12) 수직하중 저항구조"],[27,2,2,16,"경골목구조"],[27,18,1,19,"중목구조"],[28,18,1,3,"위치"],[28,21,1,3,"종류"],[28,24,1,6,"단면치수 \n (mmxmm)"],[28,30,1,5,"간격 \n (m)"],[28,35,1,2,"적용 경간표"],[29,2,2,1,"1층 스터드"],[29,3,2,4,"단면치수 \n (mmxmm)"],[29,7,2,3,""],[29,10,2,4,"간격"],[29,14,2,4,"mm"],[29,18,2,3,"1층"],[29,21,1,3,"기둥"],[29,24,1,6,""],[29,30,1,5,""],[29,35,1,2,""],[30,21,1,3,"보"],[30,24,1,6,""],[30,30,1,5,""],[30,35,1,2,""],[31,2,2,1,"2층 스터드"],[31,3,2,4,"단면치수 \n (mmxmm)"],[31,7,2,3,""],[31,10,2,4,"간격"],[31,14,2,4,"mm"],[31,18,2,3,"2층"],[31,21,1,3,"기둥"],[31,24,1,6,""],[31,30,1,5,""],[31,35,1,2,""],[32,21,1,3,"보"],[32,24,1,6,""],[32,30,1,5,""],[32,35,1,2,""],[33,0,4,2,"13) 내력벽 또는 전단벽"],[33,2,2,2,"방향"],[33,4,1,7,"동(mm)"],[33,11,1,9,"서(mm)"],[33,20,1,11,"남(mm)"],[33,31,1,6,"북(mm)"],[34,4,1,4,"길이"],[34,8,1,3,"최소길이"],[34,11,1,4,"길이"],[34,15,1,5,"최소길이"],[34,20,1,5,"길이"],[34,25,1,6,"최소길이"],[34,31,1,5,"길이"],[34,36,1,1,"최소길이"],[35,2,1,2,"1층 내력벽 인정구간"],[35,4,1,4,""],[35,8,1,3,""],[35,11,1,4,""],[35,15,1,5,""],[35,20,1,5,""],[35,25,1,6,""],[35,31,1,5,""],[35,36,1,1,""],[36,2,1,2,"2층 내력벽 인정구간"],[36,4,1,4,""],[36,8,1,3,""],[36,11,1,4,""],[36,15,1,5,""],[36,20,1,5,""],[36,25,1,6,""],[36,31,1,5,""],[36,36,1,1,""],[37,0,4,2,"14) 기초"],[37,2,1,16,"매립지역/연약한 토사지반 해당 유무"],[37,18,1,19,"유 / 무"],[38,2,2,3,"경골목구조"],[38,5,1,4,"줄기초( )"],[38,9,1,4,"기초벽 두께"],[38,13,1,6,"mm"],[38,19,1,3,"기초 \n 두께"],[38,22,1,5,"mm"],[38,27,1,7,"기초 \n 너비"],[38,34,1,3,"mm"],[39,5,1,4,"온통기초( )"],[39,9,1,8,"보강부분 너비"],[39,17,1,6,"mm"],[39,23,1,9,"보강부분 깊이"],[39,32,1,5,"mm"],[40,2,1,3,"중목구조"],[40,5,1,4,"기둥기초"],[40,9,1,4,"가로"],[40,13,1,6,"mm"],[40,19,1,3,"세로"],[40,22,1,5,"mm"],[40,27,1,7,"깊이"],[40,34,1,3,"mm"],[41,0,2,2,"15) 비구조요소"],[41,2,1,3,"건축비구조요소"],[41,5,1,23,""],[41,28,2,9,"공사단계에서 확인이 필요한 비구조요소 기재"],[42,2,1,3,"기계ㆍ전기 비구조요소"],[42,5,1,23,""],[43,0,1,2,"16) 특이사항"],[43,2,1,35,""],[44,0,1,37,"「건축법」 제48조 및 같은 법 시행령 제32조에 따라 건축물의 구조안전 및 내진설계 확인서를 제출합니다. \n  년   월   일 \n 작성자(설계자):           (서명 또는 인) \n   주소:                                                 / 연락처:"],[45,0,1,37,"210㎜×297㎜[백상지(80g/㎡)]"]]}};
const finite = v => typeof v === 'number' && Number.isFinite(v);
const number = v => finite(v) ? String(Math.round(v * 1000) / 1000) : '';
const max = a => a.length && a.every(finite) ? Math.max(...a) : undefined;
const min = a => a.length && a.every(finite) ? Math.min(...a) : undefined;
const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yesNo = v => v === true ? '유' : v === false ? '무' : undefined;

/** {ok, chapter, fields:{key:{value,source,detail,...}}, missing:[{key,label,question}], table}.
 * source: '엔진 값'|'검토 항목'|'project 입력'|'작성자 기입'.
 * missing 값은 임의 기본값으로 채우지 않는다. info는 합격 판정으로 바꾸지 않는다. */
export function certificateFields(model, review, project = {}) {
  const reasons = [];
  const checkboxKeys=new Set(['deadLoadExcess','liveLoadExcess','snowExcess','windExcess','verticalDiscontinuity','sameStructuralSystem','cantilever','softSoil']);
  if (!model || !TEMPLATES[model.system]) reasons.push('지원 구조는 콘크리트구조(rc)·강구조(steel)·목구조(wood)입니다.');
  if (!Array.isArray(review) || !review.length) reasons.push('엔진 검토 결과가 없어 소규모건축구조기준 적용 여부를 확인할 수 없습니다.');
  if (Array.isArray(review)) for (const f of review) if (f.st === 'ng') reasons.push([f.item, f.val, f.req].filter(Boolean).join(' · '));
  const p = model?.p || {}, members = model?.members || [];
  if (!members.length) reasons.push('구조 부재 목록이 없습니다.');
  if (model?.reviewMethod==='kds41-preliminary' || p.reviewMethod==='kds41-preliminary' || (Array.isArray(p.floors)&&p.floors.length>2) || !Number.isInteger(p.stories) || p.stories < 1 || p.stories > 2) reasons.push('제3호서식 적용 층수(2층 이하)를 확인할 수 없습니다.');
  // 판정 누락·필수 적용 조건 누락도 합격으로 취급하지 않는다.
  for (const item of ['층수', '연면적', '용도', '지반', '적설 지역']) {
    const f = Array.isArray(review) && review.find(f => f.item === item);
    if (!f || !['ok','ng'].includes(f.st)) reasons.push(item + '의 적용 검토가 완료되지 않았습니다.');
  }
  if (reasons.length) return {ok:false, reason:'범위 밖(구조계산 필요) 또는 검토 미완료 — 제3호서식 확인서를 만들 수 없습니다.', reasons:[...new Set(reasons)], missing:[]};
  if (!project || typeof project !== 'object' || Array.isArray(project)) throw Error('project는 칸 이름과 값을 담은 객체여야 합니다.');
  const system = model.system, template = TEMPLATES[system], fields = {}, missing = [];
  const cells = template.cells.map(([row,column,rowspan,colspan,text]) => ({row,column,rowspan,colspan,text,fontSize:7,padding:.5,border:row>1&&row<template.rowHeights.length-1}));
  const cell = (r,c) => cells.find(x => x.row===r&&x.column===c);
  const put = (r,c,text,keys=[]) => {const t=cell(r,c); if (!t) throw Error('서식 좌표 오류: '+r+','+c); t.text=String(text??''); t.fieldRefs=keys;};
  const readProject = (key,label) => {
    for (const k of [key,label]) if (Object.hasOwn(project,k) && project[k] !== '' && project[k] != null) return {value:project[k],key:k};
    return null;
  };
  const add = (key,label,value,source='엔진 값',detail='',options={}) => {
    if (value === undefined || value === null || (typeof value==='number'&&!finite(value))) {const q=readProject(key,label);if(q){value=q.value;source='project 입력';detail='project.'+q.key;}}
    if(checkboxKeys.has(key)&&typeof value==='boolean')value=yesNo(value);
    if(checkboxKeys.has(key)&&value!==undefined&&value!==null&&value!==''&&!['유','무'].includes(value))throw Error(label+'은 유/무 또는 true/false로 입력하세요.');
    const unknown = value === '' || value === undefined || value === null || (typeof value==='number'&&!finite(value));
    const valueOut = unknown ? '' : value;
    const record = fields[key] = {value:valueOut,source:unknown?'작성자 기입':source,label,detail,...options};
    if (unknown) {record.status='작성자 확인'; missing.push({key,label,question:options.question||label+' 항목에 넣을 내용을 알려 주세요. 모르면 작성자가 확인하도록 남깁니다.'});}
    return key;
  };
  const authored = (key,label,opts={}) => {const q=readProject(key,label); return add(key,label,q?.value,q?'project 입력':'작성자 기입',q?'project.'+q.key:'엔진 대응 값 없음',opts);};
  const display = key => {const f=fields[key]; return f.value==='' ? f.blank ? '' : '작성자 확인' : typeof f.value==='number' ? number(f.value) : String(f.value);};
  const place = (key,r,c,unit='') => put(r,c,display(key)+(fields[key].value!==''?unit:''),[key]);
  const fromReview = (key,label,regex,op = f => yesNo(f.st==='ng'),validInput=true) => {
    const list=review.filter(f=>regex.test(f.item));
    if (list.length && validInput && list.every(f=>['ok','ng'].includes(f.st))) {
      return add(key,label,op(list.find(f=>f.st==='ng')||list[0]),'검토 항목',list.map(f=>f.item+' · '+f.ref).join('; '),{evidence:list});
    }
    const q=readProject(key,label);
    return add(key,label,q?.value,q?'project 입력':'작성자 기입',list.map(f=>f.item+' ('+f.st+'): '+f.val).join('; ')||'대응 검토 항목 없음',{evidence:list});
  };
  const groupSummary = (list,metric) => [...new Map(list.map(m=>[m.code||m.id,null])).keys()].map(code=>{
    const ms=list.filter(m=>(m.code||m.id)===code);return {code,value:max(ms.map(metric)),ids:ms.map(m=>m.id),members:ms};
  });
  const largestSection = ms => ms.reduce((a,m)=>m.b*m.h>a.b*a.h?m:a);
  const groupedText = (list,fn) => [...new Map(list.map(m=>[m.code||m.id,fn(m)])).entries()].map(([code,v])=>code+' '+v).join('\n');
  const engineMember = (key,label,list,fn,detail='') => add(key,label,list.length?fn(list):'해당 없음','엔진 값',detail,{ids:list.map(m=>m.id)});
  const administrative = [
    ['projectName','공사명'],['siteAddress','대지위치'],['author','작성자'],['authorAddress','주소'],['authorPhone','연락처'],['date','작성일'],['signature','서명'],['licenseNumber','면허번호']
  ];
  for (const [key,label] of administrative) authored(key,label,{blank:true});
  // 면허번호는 원문에 독립 칸이 없어 메타데이터에 보관한다. 입력한 경우에만 서명란에 함께 표시한다.
  place('projectName',2,system==='wood'?2:1); place('siteAddress',3,system==='wood'?2:1);
  const cHeight = system==='rc'?2:system==='steel'?3:6, cStory=system==='rc'?10:system==='steel'?11:26;
  for (const [level,row] of [[2,4],[1,5]]) {add('story'+level+'Height','지상 '+level+'층 층고',level>p.stories?'해당 없음':model.floors?.[level-1]?.H??p.H,'엔진 값','model.floors[].H 또는 model.p.H');place('story'+level+'Height',row,cHeight,level<=p.stories?' m':'');}
  authored('basementHeight','지하층 층고');place('basementHeight',6,cHeight,' m');
  authored('basementStories','지하층수');
  if(fields.basementStories.value===0||fields.basementStories.value==='0'){fields.basementHeight={...fields.basementHeight,value:'해당 없음',source:'project 입력',detail:'project 지하층수 0'};delete fields.basementHeight.status;missing.splice(missing.findIndex(f=>f.key==='basementHeight'),1);place('basementHeight',6,cHeight);}
  add('stories','지상층수',p.stories,'엔진 값','model.p.stories');
  put(4,cStory,'지하('+display('basementStories')+')층/지상('+display('stories')+')층',['basementStories','stories']);
  const areaCheck=review.find(f=>f.item==='연면적'),area=parseFloat(areaCheck.val);
  add('totalArea','연면적',finite(area)?area:undefined,'검토 항목',areaCheck.ref,{evidence:[areaCheck]});place('totalArea',5,cStory,' m²');
  const use=review.find(f=>f.item==='용도');
  add('use','용도',p.use==='house'?'주거 시설':p.use==='retail'?'근린생활 시설':undefined,'검토 항목',use.ref,{evidence:[use]});
  put(7,system==='wood'?2:1,'주거 시설('+(p.use==='house'?'X':' ')+') / 근린생활 시설('+(p.use==='retail'?'X':' ')+')',['use']);
  if(system==='wood') add('frameType','구조형식','경골목구조','엔진 값','woodWall·joists·rafters 모델');
  else authored('frameType','구조형식');
  put(8,system==='wood'?2:1,system==='wood'?'경골목구조(X) / 중목구조( )':display('frameType')==='작성자 확인'?'횡구속골조( ) / 비횡구속골조( ) · 작성자 확인':display('frameType'),['frameType']);
  const checkC=system==='rc'?7:system==='steel'?8:18;
  fromReview('deadLoadExcess','바닥 고정하중 초과 유무',/바닥 고정하중|설계하중/);
  fromReview('liveLoadExcess','바닥 활하중 초과 유무',/바닥 활하중|설계하중/);
  fromReview('snowExcess','적설하중 초과지역 해당',/적설 지역/,undefined,['normal','east','heavy'].includes(p.snow));
  fromReview('windExcess','풍하중 초과지역 해당',/바람|풍하중/,undefined,['normal','D35','D40','D40+','C40+'].includes(p.wind));
  if(fields.windExcess.value===''&&p.wind==='normal'){fields.windExcess={...fields.windExcess,value:'무',source:'엔진 값',detail:'model.p.wind = normal(일반지역)'};delete fields.windExcess.status;missing.splice(missing.findIndex(f=>f.key==='windExcess'),1);}
  fromReview('verticalDiscontinuity','수직부재 불연속',/위아래 연속/);
  fromReview('sameStructuralSystem','1,2층 구조형식 동일성',/구조형식 동일/,f=>yesNo(f.st==='ok'));
  if(fields.sameStructuralSystem.value==='' && !readProject('sameStructuralSystem','1,2층 구조형식 동일성')) {
    // 입력에 층별 구조형식이 없어 model.system만으로 동일성을 단정하지 않는다.
    fields.sameStructuralSystem.detail='층별 구조형식의 동일성을 판정하는 검토 항목 없음';
  }
  const cant=review.filter(f=>/캔틸레버/.test(f.item));
  const cantLengths=cant.map(f=>/^\s*([\d.]+)\s*m/.exec(String(f.val))?.[1]).map(v=>v===undefined?undefined:Number(v));
  const cantL=cant.length&&cant.every(f=>f.st==='ok')?max(cantLengths):p.stories===1?0:undefined;
  add('cantilever','캔틸레버보 유무',finite(cantL)?yesNo(cantL>0):undefined,'검토 항목','floors 캔틸레버 검토',{evidence:cant});
  add('cantileverLength','캔틸레버보 최대 길이',cantL,'검토 항목','floors 캔틸레버 검토, 단위 m',{evidence:cant});
  for(const [i,key] of ['deadLoadExcess','liveLoadExcess','snowExcess','windExcess','verticalDiscontinuity','sameStructuralSystem','cantilever'].entries())place(key,9+i,checkC);
  place('cantileverLength',16,system==='rc'?8:system==='steel'?10:22,' m');
  add('planWidth','평면 가로길이',p.X,'엔진 값','model.p.X');add('planDepth','평면 세로길이',p.Y,'엔진 값','model.p.Y');
  if(system==='steel')put(17,3,'가로길이: '+display('planWidth')+' m\n세로길이: '+display('planDepth')+' m',['planWidth','planDepth']);
  else put(17,system==='rc'?5:16,system==='wood'?number(Math.max(p.X,p.Y))+' m\n'+number(Math.min(p.X,p.Y))+' m':display('planWidth')+' m\n'+display('planDepth')+' m',['planWidth','planDepth']);
  const slabs=members.filter(m=>m.kind==='slab'),beams=members.filter(m=>m.kind==='beam');
  if(system!=='wood') {
  const spans=[model.gx,model.gy].flatMap(a=>Array.isArray(a)?a.slice(1).map((v,i)=>v-a[i]):[]);
  add('columnSpanMax','기둥경간 최대',max(spans),'엔진 값','model.gx·gy의 축선 간격');add('columnSpanMin','기둥경간 최소',min(spans),'엔진 값','model.gx·gy의 축선 간격');
  // W는 분담폭이므로 배치간격으로 사용하지 않는다. 실제 슬래브 단변을 사용한다.
  const slabSpans=slabs.map(m=>m.short);
  add('beamSpacingMax','보 배치간격 최대',max(slabSpans),'엔진 값','슬래브 단변 m (분담폭 W와 구분)');add('beamSpacingMin','보 배치간격 최소',min(slabSpans),'엔진 값','슬래브 단변 m');
  }
  const miscRow=system==='rc'?40:43,nonstructRow=system==='rc'?38:41;
  for(const [key,label,r,c] of [['architecturalNonstructural','비구조요소_건축',nonstructRow,system==='wood'?5:2],['mechanicalNonstructural','비구조요소_설비',nonstructRow+1,system==='wood'?5:2],['remarks','특이사항',miscRow,system==='wood'?2:1]]){authored(key,label);place(key,r,c);}
  const soil=review.find(f=>f.item==='지반');
  add('softSoil','매립지역/연약한 토사지반 해당 유무',p.soilOk===true&&finite(p.Fe)?'무':undefined,'검토 항목',soil.ref,{evidence:[soil]});
  if(system!=='wood') {
    place('columnSpanMax',18,system==='rc'?4:5,' m');if(system==='rc')place('columnSpanMin',18,9,' m');
    place('beamSpacingMax',19,system==='rc'?4:5,' m');if(system==='rc')place('beamSpacingMin',19,9,' m');
    const matRow=system==='rc'?20:22;
    authored('concreteStrength','콘크리트 설계기준압축강도');place('concreteStrength',matRow,system==='rc'?3:4,' MPa');
    authored('rebarStrength','철근 항복강도');place('rebarStrength',matRow,system==='rc'?10:11);
    const sr=system==='rc'?21:24;
    engineMember('slabSpan','슬래브 단변방향 최대경간',slabs,ms=>max(ms.map(m=>m.short)),'model.members[].short');place('slabSpan',sr,system==='rc'?2:6,' m');
    engineMember('slabThickness','슬래브 두께',slabs,ms=>max(ms.map(m=>m.t)),'부재 두께 최댓값 mm');place('slabThickness',sr,system==='rc'?10:11,' mm');
    for(const [type,label,r] of [['B','작은보',system==='rc'?24:26],['G1','큰보',system==='rc'?25:27],['G2','작은보를 지지하는 큰보',system==='rc'?26:28]]) {
      const list=beams.filter(m=>m.type===type),key='beam'+type;
      engineMember(key+'Span',label+' 최대경간',list,ms=>max(ms.map(m=>m.L)),'부재 L 최댓값 m');place(key+'Span',r,system==='rc'?2:6);
      if(system==='rc')for(const [prop,col] of [['b',7],['h',10]]) {engineMember(key+prop,label+(prop==='b'?' 폭':' 깊이'),list,ms=>largestSection(ms)[prop],'최대 단면적의 실제 부재 한 쌍(b×h), mm');place(key+prop,r,col);}
      else {engineMember(key+'Sections',label+' H형강 단면',list,ms=>groupedText(ms,m=>m.sec),'부호별 실제 단면(독립적인 폭·높이 조합을 만들지 않음)');place(key+'Sections',r,8);}
      engineMember(key+'Members',label+' 부호별 크기·배근',list,ms=>groupSummary(ms,m=>m.L).map(g=>({code:g.code,maxSpan:g.value,sizes:[...new Set(g.members.map(m=>m.sec||m.b+'×'+m.h))],reinforcement:g.members.map(m=>({id:m.id,bars:m.bars??null})),ids:g.ids})),'서식 외 상세 추적자료');
    }
    for(const [level,label,r] of [[2,'2층 기둥',system==='rc'?29:30],[1,'1층 기둥',system==='rc'?30:31],[0,'지하층 기둥',system==='rc'?31:32]]) {
      const list=members.filter(m=>m.kind==='column'&&m.level===level),key='column'+level;
      if(level===0 && fields.basementStories.value!==0 && fields.basementStories.value!=='0') {
        authored(key+'Area',label+' 부하면적');if(system==='rc'){authored(key+'b',label+' 폭');authored(key+'h',label+' 깊이');}else authored(key+'Section',label+' 단면');
      } else {
        engineMember(key+'Area',label+' '+(system==='rc'?'최대누적부하면적':'최대부하면적'),list,ms=>max(ms.map(m=>system==='rc'?m.Acum:m.A)),system==='rc'?'model.members[].Acum':'model.members[].A (누적면적과 구분)');
        if(system==='rc')for(const prop of ['b','h'])engineMember(key+prop,label+(prop==='b'?' 폭':' 깊이'),list,ms=>largestSection(ms)[prop],'최대 단면적의 실제 부재 한 쌍(b×h), mm');
        else engineMember(key+'Section',label+' 단면',list,ms=>groupedText(ms,m=>m.sec),'층별 부호별 실제 단면');
      }
      place(key+'Area',r,system==='rc'?2:6);
      if(system==='rc'){place(key+'b',r,7);place(key+'h',r,10);}else place(key+'Section',r,8);
    }
    const frow=system==='rc'?32:33;place('softSoil',frow,system==='rc'?7:8);
    const columnF=members.filter(m=>['footing','mat'].includes(m.kind)),wallF=members.filter(m=>['strip','mat'].includes(m.kind));
    const foundText=ms=>[...new Set(ms.map(m=>({footing:'독립기초',mat:'온통기초',strip:'줄기초'}[m.kind])+' / '+(m.D??m.t)+' mm'))].join('\n');
    engineMember('columnFoundation','기둥하부 기초형식/두께',columnF,foundText,'부호별 기초 D 또는 t');engineMember('wallFoundation','벽체하부 기초형식/두께',wallF,foundText,'부호별 기초 D 또는 t');
    put(frow+1,system==='rc'?7:6,'기둥하부: '+display('columnFoundation')+'\n벽체하부: '+display('wallFoundation'),['columnFoundation','wallFoundation']);
    const walls=members.filter(m=>m.kind==='wall');
    if(system==='rc')for(const [dir,r] of [['x',36],['y',37]]) {
      for(const level of [1,2]){const ws=walls.filter(m=>m.dir===dir&&m.level===level),key='wall'+dir+level;engineMember(key,(dir==='x'?'가로':'세로')+' '+level+'층 전단벽 총 길이',ws,ms=>ms.reduce((a,m)=>a+(m.len??0),0),'개구부·기둥 공제 후 members[].len 합계 m');place(key,r,level===1?2:6);}
      engineMember('wall'+dir+'Thickness',(dir==='x'?'가로':'세로')+' 전단벽 두께',walls.filter(m=>m.dir===dir),ms=>[...new Set(ms.map(m=>m.t))].sort((a,b)=>a-b).join('/'),'두께가 다르면 모두 표시 mm');place('wall'+dir+'Thickness',r,10);
    }
    if(system==='steel') {
      add('roofConstruction','지붕 구조 형식',typeof model.light==='boolean'?(model.light?'경량마감지붕':'철근콘크리트지붕'):undefined,'엔진 값','model.light');place('roofConstruction',20,3);
      add('roofShape','지붕 형태',p.roof==='gable'?'경사지붕':p.roof==='flat'?'평지붕':undefined,'엔진 값','model.p.roof');place('roofShape',21,3);
      authored('steelGrade','강재 규격');put(23,3,'규격: '+display('steelGrade'),['steelGrade']);authored('steelStrength','강재 항복강도');place('steelStrength',23,9,' MPa');
      const braces=members.filter(m=>m.kind==='brace');add('shearWallExists','전단벽 유무',yesNo(walls.length>0),'엔진 값','wall 목록');place('shearWallExists',35,2);add('braceExists','수직가새 유무',yesNo(braces.length>0),'엔진 값','brace 목록');place('braceExists',38,2);
      for(const [dir,col] of [['x',8],['y',12]]) {
        const ws=walls.filter(m=>m.dir===dir),bs=braces.filter(m=>m.dir===dir);
        const perFloor=(ms,fn)=>Array.from({length:p.stories},(_,i)=>(i+1)+'층 '+fn(ms.filter(m=>m.level===i+1))).join('\n');
        add('steelWall'+dir+'Count','전단벽 '+dir+' 층별 개소/총 길이',perFloor(ws,ms=>ms.length+'개 / '+number(ms.reduce((a,m)=>a+m.len,0))+' m'),'엔진 값','층별 실제 부재 수·len 합');place('steelWall'+dir+'Count',36,col);
        add('steelWall'+dir+'Thickness','전단벽 '+dir+' 두께',ws.length?[...new Set(ws.map(m=>m.t))].join('/'):'해당 없음','엔진 값','members[].t');place('steelWall'+dir+'Thickness',37,col);
        add('brace'+dir+'Count','가새 '+dir+' 층별 개소',perFloor(bs,ms=>ms.length+'개'),'엔진 값','층별 brace 목록');place('brace'+dir+'Count',38,col);
        add('brace'+dir+'Angles','가새 '+dir+' 각도',bs.length?[...new Set(bs.map(m=>m.ang))].join('/'):'해당 없음','엔진 값','실제 brace.ang 도');place('brace'+dir+'Angles',39,col);
      }
    }
  } else {
    // 경골목구조만 생성하는 엔진. 중목구조 칸에 가상의 기둥·보를 만들지 않는다.
    const vertical=review.find(f=>f.item==='수직하중구조 · 전단벽선 간격');
    const a=vertical&&/내력벽 간격 ([\d.]+) m/.exec(vertical.val),b=vertical&&/전단벽선 간격 ([\d.]+) m/.exec(vertical.val);
    add('verticalSupportSpacing','수직하중지지구조 최대 간격',a?+a[1]:undefined,'검토 항목',vertical?.ref);place('verticalSupportSpacing',18,12,' m');
    add('bearingWallSpacing','내력벽 사이 최대 거리',b?+b[1]:undefined,'검토 항목',vertical?.ref);place('bearingWallSpacing',19,12,' m');
    put(18,18,'');put(19,18,'');
    authored('woodType','구조용 목재 종류');place('woodType',20,6);
    authored('woodSpecies','수종');fields.woodSpecies.detail='엔진 수종군 '+(p.species??'미상')+' (실제 수종명은 작성자 확인)';place('woodSpecies',20,18);
    add('woodGrade','목재 등급',p.grade,'엔진 값','model.p.grade');place('woodGrade',20,33,'등급');
    for(const [kind,prefix,r] of [['rafters','roof',21],['ceilJoists','ceiling',23],['joists','floor',25]]) {
      const ms=members.filter(m=>m.kind===kind);
      engineMember(prefix+'Span',kind+' 최대경간',ms,ls=>max(ls.map(m=>kind==='rafters'?m.run:m.span)),'서까래는 수평 경간(run), 장선은 span, m');place(prefix+'Span',r,6);
      engineMember(prefix+'Size',kind+' 단면치수',ms,ls=>groupedText(ls,m=>(m.b??38)+'×'+m.h),'부호별 실제 b×h mm');place(prefix+'Size',r,18);
      engineMember(prefix+'Table',kind+' 적용 경간표',ms,ls=>[...new Set(ls.map(m=>m.basis?.match(/표\s*[\d.]+-\d+/)?.[0]).filter(Boolean))].join('/'),'members[].basis 경간표');place(prefix+'Table',r,33);
      for(const [suffix,label,col] of [['Sheathing','덮개 종류',6],['SheathingThickness','덮개 두께',18],['Nailing','못박기 간격',33]]){authored(prefix+suffix,(prefix==='roof'?'지붕':prefix==='ceiling'?'천장':'바닥')+' '+label);place(prefix+suffix,r+1,col,suffix==='Sheathing'?'':' mm');}
    }
    const woodWalls=members.filter(m=>m.kind==='woodWall');
    for(const [level,r] of [[1,29],[2,31]]){
      const ms=woodWalls.filter(m=>m.level===level);
      engineMember('stud'+level+'Size',level+'층 스터드 단면',ms,ls=>[...new Set(ls.map(m=>(m.b??38)+'×'+m.stud))].join('/'),'members[].b×stud mm');place('stud'+level+'Size',r,7);
      engineMember('stud'+level+'Spacing',level+'층 스터드 간격',ms,ls=>[...new Set(ls.map(m=>m.sp))].join('/'),'members[].sp mm');place('stud'+level+'Spacing',r,14,' mm');
      for(const rr of [r,r+1])for(const col of [24,30,35])put(rr,col,'-');
    }
    // 바깥 벽만 동·서·남·북으로 분류한다. 불규칙 외곽으로 방향이 명확하지 않으면 작성자 확인.
    const tol=1e-6;
    const bySide=(side,level)=>woodWalls.filter(m=>m.level===level&&m.ext&&(
      side==='동'?Math.abs(m.x0-p.X)<tol&&Math.abs(m.x1-p.X)<tol:side==='서'?Math.abs(m.x0)<tol&&Math.abs(m.x1)<tol:side==='남'?Math.abs(m.y0)<tol&&Math.abs(m.y1)<tol:Math.abs(m.y0-p.Y)<tol&&Math.abs(m.y1-p.Y)<tol));
    for(const [level,r] of [[1,35],[2,36]])for(const [side,cLen,cMin] of [['동',4,8],['서',11,15],['남',20,25],['북',31,36]]) {
      const ws=bySide(side,level),key='woodWall'+level+side;
      if(ws.length){add(key+'Length',level+'층 '+side+' 내력벽 인정구간 길이',Math.round(ws.reduce((n,m)=>n+m.have,0)*1000),'엔진 값','개구부를 뺀 have 합계(m→mm)',{ids:ws.map(m=>m.id)});add(key+'Minimum',level+'층 '+side+' 내력벽 최소길이',Math.round(ws.reduce((n,m)=>n+m.need,0)*1000),'엔진 값','필요 전단벽 길이 need 합계(m→mm), 조각 최소 segMin과 구분');}
      else {add(key+'Length',level+'층 '+side+' 내력벽 인정구간 길이',level>p.stories?'-':undefined);add(key+'Minimum',level+'층 '+side+' 내력벽 최소길이',level>p.stories?'-':undefined);}
      place(key+'Length',r,cLen);place(key+'Minimum',r,cMin);
    }
    place('softSoil',37,18);
    const sf=members.filter(m=>m.kind==='stripW');put(38,5,'줄기초('+(sf.length?'X':' ')+')');put(39,5,'온통기초( )');
    for(const [key,label,prop,col] of [['stemThickness','기초벽 두께','stem',13],['footThickness','기초 두께','footT',22],['footWidth','기초 너비','footW',34]]){engineMember(key,label,sf,ms=>max(ms.map(m=>m[prop])),'stripW.'+prop+' mm');place(key,38,col,' mm');}
    for(const [r,c] of [[39,17],[39,32],[40,13],[40,22],[40,34]])put(r,c,'-');
  }
  // 원문에 빈 입력 셀이 남으면 누락 목록에도 남긴다. 장식용 빈칸은 위에서 명시적으로 처리한다.
  for(const t of cells)if(t.row>1&&t.row<template.rowHeights.length-2&&!t.text.trim()&&!t.fieldRefs){const key='cell_'+t.row+'_'+t.column;authored(key,'제'+template.chapter+'장 '+(t.row+1)+'행 '+(t.column+1)+'열');t.text=display(key);t.fieldRefs=[key];}
  const signRow=template.rowHeights.length-2,sign=cell(signRow,0),submission=sign.text.split('\n')[0];
  put(signRow,0,submission+'\n'+display('date')+'\n작성자(설계자): '+display('author')+' '+display('signature')+(system==='wood'?' (서명 또는 인)':' (인)')+'\n주소: '+display('authorAddress')+' / 연락처: '+display('authorPhone')+(fields.licenseNumber.value?'\n면허번호: '+display('licenseNumber'):''),administrative.map(x=>x[0]));
  for(const t of cells){if(t.text==='작성자 확인')t.padding=.25;if(t.row===0){t.fontSize=6.8;}else if(t.row===1){t.fontSize=10.5;t.align='center';}else if(t.row===template.rowHeights.length-1){t.fontSize=6;t.align='center';}else if(t.row===signRow)t.fontSize=7;}
  const projectScope=[];
  for(const key of ['deadLoadExcess','liveLoadExcess','snowExcess','windExcess','verticalDiscontinuity','softSoil'])if(fields[key]?.value==='유')projectScope.push(fields[key].label+' 유');
  if(fields.sameStructuralSystem?.value==='무')projectScope.push('1,2층 구조형식이 다릅니다.');
  const cantLength=fields.cantileverLength.value;
  if(cantLength!==''&&(!Number.isFinite(Number(cantLength))||Number(cantLength)<0))throw Error('캔틸레버 길이는 0 이상의 수(m)로 입력하세요.');
  if(Number(cantLength)>1.5)projectScope.push('캔틸레버 길이 1.5 m 초과');
  if(Number(fields.basementStories.value)>0)projectScope.push('엔진에 지하층 구조 모델이 없어 지하층의 추가 검토가 필요합니다.');
  if(projectScope.length)return {ok:false,reason:'범위 밖(구조계산 필요) — 보충한 적용제한 값으로는 제3호서식을 만들 수 없습니다.',reasons:projectScope,missing};
  // 같은 격자를 유지하면서 좁은 칸의 '작성자 확인'·부호별 여러 줄에 필요한 높이만 확보한다.
  const rowHeights=[...template.rowHeights];
  for(const c of cells)if(c.text==='작성자 확인'&&template.columnWidths.slice(c.column,c.column+c.colspan).reduce((a,b)=>a+b,0)<12)c.text='작성자\n확인';
  for(const c of cells){
    const width=template.columnWidths.slice(c.column,c.column+c.colspan).reduce((a,b)=>a+b,0)-2*c.padding;
    const font=Math.min(c.fontSize,6), capacity=width*72/25.4/font;
    let lines=0;
    for(const text of c.text.split('\n')){let used=0;lines++;for(const ch of text){const unit=/\s/.test(ch)?.3:ch.charCodeAt(0)<128?.56:1;if(used+unit>capacity&&used>0){lines++;used=0;}used+=unit;}}
    const required=lines*font*1.15*25.4/72+2*c.padding+.15, current=rowHeights.slice(c.row,c.row+c.rowspan).reduce((a,b)=>a+b,0);
    if(required>current)rowHeights[c.row+c.rowspan-1]+=required-current;
  }
  if(rowHeights.reduce((a,b)=>a+b,0)>277)throw Error('확인서 내용이 A4 한 장을 넘습니다. 입력을 줄이거나 작성자가 별도 기재해 주세요.');
  const table={columnWidths:[...template.columnWidths],rowHeights,rows:template.rowHeights.map((_,r)=>cells.filter(c=>c.row===r)),marginTop:10};
  return {ok:true,system,chapter:template.chapter,fields,missing,table};
}

/** 원문 표의 rowspan/colspan과 같은 A4 세로 인쇄 HTML. 모든 입력은 텍스트로 escape. */
export function certificateHtml(fields) {
  if(!fields?.ok || !fields.table)throw Error(fields?.reason||'확인서 생성이 거절되었습니다.');
  const {table}=fields;
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; style-src &apos;unsafe-inline&apos;; font-src &apos;self&apos; file: data:"><title>구조안전 및 내진설계 확인서(소규모건축물)</title><style>'+ 
    '@font-face{font-family:CADKorean;src:url("fonts/NanumGothic-Regular.ttf")}@page{size:A4 portrait;margin:10mm 12mm}*{box-sizing:border-box}html,body{margin:0;color:#000;background:#fff;font-family:CADKorean,"NanumGothic","Malgun Gothic",sans-serif}table{width:186mm;table-layout:fixed;border-collapse:collapse;margin:0 auto;break-inside:avoid}td{border:.2mm solid #000;vertical-align:middle;overflow-wrap:anywhere;white-space:pre-wrap;line-height:1.15}tr{break-inside:avoid}@media screen{body{padding:10mm 12mm;width:210mm;min-height:297mm}}'+
    '</style></head><body><table aria-label="별지 제3호서식 제'+fields.chapter+'장"><colgroup>'+table.columnWidths.map(w=>'<col style="width:'+w+'mm">').join('')+'</colgroup><tbody>'+table.rows.map((row,r)=>'<tr style="height:'+table.rowHeights[r]+'mm">'+row.map(c=>'<td data-row="'+c.row+'" data-column="'+c.column+'" rowspan="'+c.rowspan+'" colspan="'+c.colspan+'" style="font-size:'+c.fontSize+'pt;padding:'+c.padding+'mm;'+(c.border===false?'border:0;':'')+(c.align?'text-align:'+c.align+';':'')+'"'+(c.fieldRefs?.length?' title="'+escape(c.fieldRefs.map(k=>fields.fields[k]?.source+': '+fields.fields[k]?.detail).join('; '))+'"':'')+'>'+escape(c.text)+'</td>').join('')+'</tr>').join('')+'</tbody></table></body></html>';
}
