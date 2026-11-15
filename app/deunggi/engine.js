/* 등기부 판독 엔진: 브라우저(window.DG)와 Node(module.exports) 공용.
 * 1) extractPdf: pdf.js로 글자 위치·선(말소 실선, 표 격자)을 뽑는다.
 * 2) parseDocument: 표제부·갑구·을구·주요 등기사항 요약을 표 단위로 복원한다.
 * 3) analyze: 말소 여부를 판정하고 특이사항·조합 패턴·금액·말소기준권리를 계산한다.
 * 4) buildAIPrompt: Claude 추론 요청문을 만든다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DG = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NS = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ''); };
  // 근거 문구: 2026-11-15 법령 원문 대조로 확인된 것만 둔다(법리 검증 담당 목록).
  var BASIS = {
    tenancy_opposability: ['주택임대차보호법 제3조 제1항', '집을 넘겨받고(인도) 전입신고를 마치면 그 다음 날부터 제3자에게 임대차를 주장할 수 있는 대항력이 생깁니다.'],
    priority_repay: ['주택임대차보호법 제3조의2 제2항', '대항요건에 확정일자까지 갖추면 경매·공매 대금에서 자신보다 뒤 순위인 권리자보다 먼저 보증금을 받을 권리가 생깁니다. 앞 순위 권리보다 먼저 받는다는 뜻은 아닙니다.'],
    lease_order: ['주택임대차보호법 제3조의3 제1항', '임차권등기명령은 임대차가 끝난 뒤 보증금을 돌려받지 못한 임차인이 법원에 신청하는 제도입니다.'],
    lease_order_effect: ['주택임대차보호법 제3조의3 제5항', '임차권등기가 된 뒤에는 그 임차인이 이사하거나 전출해도 이미 갖춘 대항력과 우선변제권이 유지됩니다.'],
    lease_order_small: ['주택임대차보호법 제3조의3 제6항', '임차권등기명령에 따른 임차권등기가 끝난 집(또는 그 부분)을 그 이후에 빌린 임차인은 소액임차인 최우선변제(제8조)를 받을 수 없습니다.'],
    lease_civil: ['민법 제621조', '임대인 협력으로 한 임대차등기는 등기한 때부터 제3자에게 효력이 생깁니다.'],
    lease_civil_effect: ['주택임대차보호법 제3조의4 제1항', '민법 제621조에 따른 주택임대차등기에도 제3조의3 제5항·제6항이 준용됩니다.'],
    tenancy_survive: ['주택임대차보호법 제3조의5', '경매로 임차권은 원칙적으로 소멸하지만, 대항력이 있고 보증금을 다 돌려받지 못한 임차권은 소멸하지 않습니다.'],
    tenancy_info: ['주택임대차보호법 제3조의6 제4항', '등기부에 나오지 않는 다른 임차인의 확정일자·보증금 정보는 계약하려는 사람이 임대인 동의를 받아 확정일자부여기관에 요청할 수 있습니다.'],
    lessor_info: ['주택임대차보호법 제3조의7', '계약할 때 임대인은 선순위 확정일자·보증금 정보와 국세·지방세 납세증명서를 제시해야 하며, 열람 동의로 갈음할 수 있습니다(2023년 4월 18일 이후 체결 계약부터 적용).'],
    small_tenant: ['주택임대차보호법 제8조, 시행령 제10조·제11조', '보증금이 지역별 기준 이하인 소액임차인은 경매신청 등기 전에 인도와 전입을 마쳤다면 보증금 중 일정액을 다른 담보물권자보다 먼저 받을 수 있습니다. 그 금액은 주택가액의 2분의 1 범위로 제한됩니다.'],
    small_tenant_rule: ['주택임대차보호법 시행령 부칙(2023. 2. 21. 등)', '시행 전에 담보물권을 취득한 자에 대해서는 종전 규정에 따릅니다. 따라서 이 집에 먼저 설정된 담보물권의 설정 시점 기준표로 따질 수 있습니다.'],
    auction: ['민사집행법 제83조 제1항·제4항, 제94조', '경매개시결정 등기는 법원이 경매를 시작하면서 부동산을 압류했다는 표시이며, 법원의 촉탁으로 등기관이 기록합니다.'],
    dividend_end: ['민사집행법 제84조', '경매가 시작되면 법원이 배당요구 마감일(종기)을 첫 매각기일 이전으로 정해 공고합니다.'],
    sale_mortgage: ['민사집행법 제91조 제2항', '경매로 매각되면 등기부의 저당권(근저당 포함)은 순위와 관계없이 모두 소멸합니다.'],
    sale_other: ['민사집행법 제91조 제3항', '지상권·지역권·전세권·등기된 임차권은 저당권·압류채권·가압류채권에 대항할 수 없는 경우 매각으로 소멸합니다.'],
    sale_take: ['민사집행법 제91조 제4항', '저당권·압류·가압류보다 앞선 지상권·지역권·전세권·등기된 임차권은 매수인이 인수합니다. 다만 그 전세권자가 배당요구를 하면 전세권은 매각으로 소멸합니다.'],
    lien: ['부동산등기법 제3조, 민사집행법 제91조 제5항', '유치권은 등기할 수 있는 권리 목록에 없어 등기부에 나타나지 않지만, 매수인은 유치권자에게 그 피담보채권을 변제할 책임이 있습니다.'],
    attach: ['민사집행법 제276조', '가압류는 금전채권(또는 금전으로 환산할 수 있는 채권)을 가진 사람이 장래 강제집행을 보전하려고 부동산을 미리 묶어 둔 것입니다.'],
    injunction: ['민사집행법 제300조', '가처분은 이 부동산 자체를 두고 다툼이 있는 사람이 현재 상태를 묶어 두려고 한 것입니다.'],
    injunction_ban: ['민사집행법 제305조 제3항', '처분금지가처분 등기는 법원이 이 부동산의 양도나 저당을 금지했다는 표시입니다.'],
    injunction_reg: ['부동산등기법 제94조', '처분금지가처분 뒤에 이루어진 등기는 가처분채권자가 권리를 실현하는 등기를 할 때 함께 말소될 수 있습니다.'],
    p_2018da276218: ['대법원 2022. 6. 30. 선고 2018다276218 판결', '처분금지가처분 등기 뒤의 처분행위는 가처분채권자가 본안에서 승소 확정되면 그 권리 범위에서 가처분채권자에게 효력을 주장하지 못할 수 있고, 저촉 여부는 등기의 선후로 정합니다.'],
    jeonse_auction: ['민법 제318조', '전세금 반환이 지체되면 전세권자는 그 부동산의 경매를 청구할 수 있습니다.'],
    jeonse: ['민법 제303조 제1항', '전세권자는 그 부동산 전부에 대하여 후순위권리자보다 전세금을 먼저 돌려받을 권리를 가집니다.'],
    mortgage_max: ['민법 제357조', '근저당의 채권최고액은 담보되는 최대 한도로, 현재 실제로 남은 채무액과 다를 수 있습니다. 이자도 이 최고액 안에 포함됩니다.'],
    rank_order: ['부동산등기법 제4조', '같은 구에서는 순위번호로, 갑구와 을구 사이에서는 접수번호로 권리의 선후를 비교합니다.'],
    sub_rank: ['부동산등기법 제5조', '부기등기(예: 1-1번)는 주등기의 순위를 따릅니다.'],
    cert_pending: ['부동산등기규칙 제30조 제4항', '증명서에 등기신청사건 처리 중 표시가 있으면 아직 반영되지 않은 등기가 있을 수 있습니다.'],
    trust_reg: ['부동산등기법 제81조', '신탁등기가 있으면 소유자는 수탁자로 바뀐 상태이고, 임대·처분 권한 등은 등기기록의 일부인 신탁원부에 적혀 있습니다.'],
    trust_notice: ['부동산등기규칙 제139조의4', '신탁등기에 붙는 주의사항 부기등기는 임대차 등을 하기 전에 신탁원부를 확인하라는 법정 문구입니다. 이 부기등기가 없는 오래된 신탁등기도 있을 수 있습니다.'],
    trust_exec: ['신탁법 제22조 제1항', '신탁재산에는 원칙적으로 강제집행·경매·보전처분·체납처분을 할 수 없고, 신탁 전의 원인으로 생긴 권리 등에 기한 경우만 예외입니다.'],
    p_2019da300095: ['대법원 2022. 2. 17. 선고 2019다300095, 300101 판결', '신탁원부에 적힌 임대 조건은 임차인에게도 효력이 있어, 위탁자와 계약한 경우 보증금 반환 의무자가 신탁원부 내용에 따라 달라질 수 있다고 본 사례입니다.'],
    prov_reg: ['부동산등기법 제88조', '가등기는 장래에 소유권이전 등의 본등기를 받을 권리를 미리 확보해 둔 등기입니다.'],
    prov_reg_rank: ['부동산등기법 제91조', '가등기에 기해 본등기가 되면 그 순위는 가등기를 한 때로 올라갑니다.'],
    prov_reg_delete: ['부동산등기법 제92조', '가등기 뒤에 들어온 권리는 그 가등기에 기한 본등기가 되면 직권으로 말소될 수 있습니다.'],
    prov_reg_delete_rule: ['부동산등기규칙 제147조', '소유권이전 가등기에 기한 본등기가 되면 그 사이에 들어온 등기는 규칙이 정한 예외를 빼고 직권말소됩니다.'],
    prov_reg_scope: ['부동산등기규칙 제147조·제148조', '가등기 종류(소유권이전·전세권설정·저당권설정 등)에 따라 본등기 때 말소되는 등기의 범위가 다릅니다.'],
    prov_security_sale: ['가등기담보 등에 관한 법률 제12조 제1항', '담보가등기권리자는 경매를 청구할 수 있고, 경매에서는 그 권리를 저당권으로 봅니다.'],
    prov_security_rank: ['가등기담보 등에 관한 법률 제13조', '경매에서 담보가등기는 가등기를 마친 날 설정된 저당권과 같은 순위로 취급됩니다.'],
    prov_security_end: ['가등기담보 등에 관한 법률 제15조·제16조', '담보가등기는 경매 매각으로 소멸하며, 매각으로 소멸하는 담보가등기권리자는 채권신고를 해야 배당을 받을 수 있습니다.'],
    p_2024da291102: ['대법원 2025. 3. 27. 선고 2024다291102 판결', '담보가등기권리자가 법원이 정한 기간 안에 채권신고를 하지 않으면 배당받을 권리를 잃는다고 본 판결입니다.'],
    tax_priority: ['국세기본법 제35조 제1항 제3호', '국세는 원칙적으로 다른 채권보다 우선하지만, 세금의 법정기일보다 먼저 설정된 저당권·전세권·확정일자 임차권 등은 국세보다 먼저 변제됩니다.'],
    tax_date: ['국세기본법 제35조 제2항', '국세와 담보권의 선후는 세금의 법정기일(신고일, 납부고지서 발송일 등)로 비교하며, 등기부의 압류등기일과 다를 수 있습니다.'],
    tax_lease_special: ['국세기본법 제35조 제7항', '2023년 4월 1일 이후 매각(허가)결정되는 경매·공매부터는, 확정일자나 전세권 설정일보다 법정기일이 늦은 그 집의 상속세·증여세·종합부동산세 몫만큼 주택 임차인의 보증금이 먼저 배분될 수 있습니다.'],
    sale_cancel: ['민사집행법 제144조 제1항', '대금 납부 후 법원은 매수인이 인수하지 않는 부담의 등기와 경매개시결정등기를 말소하도록 촉탁합니다. 인수되는 권리는 말소 대상이 아닙니다.'],
    fraud_406: ['민법 제406조', '채무자가 채권자를 해하는 줄 알면서 재산을 처분하면 채권자는 그 취소와 원상회복을 법원에 청구할 수 있습니다. 받은 사람이 당시 그 사정을 몰랐다면 취소되지 않습니다. 소송은 취소원인을 안 날부터 1년, 법률행위가 있은 날부터 5년 안에 내야 합니다.'],
    fraud_407: ['민법 제407조', '사해행위가 취소되어 재산이 돌아오면 소송을 낸 채권자만이 아니라 모든 채권자를 위한 책임재산이 됩니다.'],
    fraud_tax: ['국세징수법 제25조, 지방세징수법 제39조', '세금 체납자가 징수를 피하려고 재산을 처분하거나 신탁한 경우 세무서장이나 지방자치단체의 장도 사해행위 취소를 법원에 청구할 수 있습니다.'],
    fraud_trust: ['신탁법 제8조 제1항', '채무자가 채권자를 해하는 줄 알면서 신탁을 설정하면, 수탁자가 그 사정을 몰랐더라도 채권자는 취소와 원상회복을 청구할 수 있습니다. 수익자가 수익권을 취득할 때 몰랐다면 예외입니다.'],
    p_fraud_sole: ['대법원 2017. 11. 29. 선고 2017다241819 판결', '채무자가 유일한 재산인 부동산을 매각해 소비하기 쉬운 금전으로 바꾸는 행위는 원칙적으로 사해행위가 되고 사해의사가 추정되며, 매수인이 몰랐다는 점은 매수인이 증명해야 한다고 보았습니다.'],
    p_fraud_substitute: ['대법원 2008. 2. 14. 선고 2006다33357 판결', '채무 전부를 갚기에 재산이 부족한 채무자가 유일한 재산을 특정 채권자에게 대물변제로 제공하면 특별한 사정이 없는 한 사해행위가 되지만, 우선변제권 있는 채권자에 대한 대물변제는 원칙적으로 그렇지 않다고 보았습니다.'],
    p_fraud_mortgage: ['대법원 2022. 1. 14. 선고 2018다295103 판결', '재산이 채무 전부를 갚기에 부족한 채무자가 특정 채권자에게 재산을 담보로 제공하면 특별한 사정이 없는 한 다른 채권자에 대한 사해행위가 된다고 보았습니다.'],
    p_fraud_division: ['대법원 2024. 5. 30. 선고 2024다208315 판결', '상속재산 분할협의는 사해행위취소 대상이 될 수 있고, 채무초과 상태의 상속인이 자기 상속분을 포기하는 협의는 원칙적으로 사해행위에 해당한다고 보았습니다.'],
    p_fraud_renounce: ['대법원 2011. 6. 9. 선고 2011다29307 판결', '상속의 포기는 사해행위취소의 대상이 되지 않는다고 보았습니다. 협의분할과 구별해야 합니다.'],
    p_fraud_bad_faith: ['대법원 2015. 6. 11. 선고 2014다237192 판결', '채무자의 악의는 채권자가 증명해야 하지만, 재산을 받은 사람(수익자·전득자)은 스스로 몰랐다는 사실을 증명해야 한다고 보았습니다.'],
    p_fraud_restore: ['대법원 2002. 11. 8. 선고 2002다41589 판결', '사해행위 여부는 처분 당시를 기준으로 판단하고, 저당권이 설정된 부동산이 이전된 경우 사해행위는 부동산 가액에서 저당권 피담보채권액을 뺀 범위에서 성립한다고 보았습니다.'],
    statutory_superficies: ['민법 제366조', '저당권 실행 경매로 토지와 건물의 소유자가 달라지면 토지소유자가 건물소유자에게 지상권을 설정한 것으로 봅니다.'],
    p_custom_superficies: ['대법원 2012. 10. 18. 선고 2010다52140 전원합의체 판결', '동일인 소유였던 토지와 건물이 강제경매·공매 등으로 소유자가 달라진 경우 철거 특약이 없으면 건물소유자는 관습상 법정지상권을 취득한다고 보았습니다(강제경매·공매 사안).'],
    bulk_auction: ['민법 제365조', '토지에 저당권을 설정한 뒤 설정자가 건물을 지었다면 저당권자는 토지와 건물을 함께 경매 청구할 수 있지만, 건물 매각대금에서는 우선변제를 받지 못합니다.'],
    joint_mortgage: ['민법 제368조', '같은 채권을 위해 여러 부동산에 저당권이 설정되어 함께 배당되면 각 부동산의 경매대가에 비례해 나누어 부담하고, 일부가 먼저 경매되면 후순위 저당권자가 일정 한도에서 선순위자를 대위할 수 있습니다.'],
    share_auction: ['민사집행법 제139조·제140조', '지분 경매에서는 다른 공유자에게 통지되고, 공유자는 매각기일까지 보증을 내고 최고가와 같은 가격으로 우선매수를 신고할 수 있습니다.'],
    aggregate_bldg: ['집합건물의 소유 및 관리에 관한 법률 제20조', '대지사용권은 원칙적으로 전유부분(호실)의 처분을 따르며 따로 떼어 처분할 수 없습니다. 규약으로 달리 정할 수 있고, 분리처분금지는 등기되지 않으면 선의의 제3자에게 주장할 수 없습니다.'],
    tax_prev_owner: ['국세기본법 제35조 제1항 제3호의2', '전세권 등이 설정된 뒤 집주인이 바뀐 경우, 이전 소유자의 체납 국세 중 일정 범위는 여전히 우선할 수 있습니다.']
  };
  var SMALL_TENANT = [
    { from: '2023-02-21', to: '', rows: [['서울특별시', '1억6천500만원', '5천500만원'], ['과밀억제권역(서울 제외), 세종특별자치시, 용인시, 화성시, 김포시', '1억4천500만원', '4천800만원'], ['광역시(과밀억제권역에 포함된 지역과 군지역 제외), 안산시, 광주시, 파주시, 이천시, 평택시', '8천500만원', '2천800만원'], ['그 밖의 지역', '7천500만원', '2천500만원']] },
    { from: '2021-05-11', to: '2023-02-20', rows: [['서울특별시', '1억5천만원', '5천만원'], ['과밀억제권역(서울 제외), 세종특별자치시, 용인시, 화성시, 김포시', '1억3천만원', '4천300만원'], ['광역시(과밀억제권역에 포함된 지역과 군지역 제외), 안산시, 광주시, 파주시, 이천시, 평택시', '7천만원', '2천300만원'], ['그 밖의 지역', '6천만원', '2천만원']] },
    { from: '2018-09-18', to: '2021-05-10', rows: [['서울특별시', '1억1천만원', '3천700만원'], ['과밀억제권역(서울 제외), 세종특별자치시, 용인시, 화성시', '1억원', '3천400만원'], ['광역시(과밀억제권역에 포함된 지역과 군지역 제외), 안산시, 김포시, 광주시, 파주시', '6천만원', '2천만원'], ['그 밖의 지역', '5천만원', '1천700만원']] },
    { from: '2016-03-31', to: '2018-09-17', rows: [['서울특별시', '1억원', '3천400만원'], ['과밀억제권역(서울 제외)', '8천만원', '2천700만원'], ['광역시(과밀억제권역에 포함된 지역과 군지역 제외), 세종특별자치시, 안산시, 용인시, 김포시, 광주시', '6천만원', '2천만원'], ['그 밖의 지역', '5천만원', '1천700만원']] },
    { from: '2014-01-01', to: '2016-03-30', rows: [['서울특별시', '9천500만원', '3천200만원'], ['과밀억제권역(서울 제외)', '8천만원', '2천700만원'], ['광역시(과밀억제권역에 포함된 지역과 군지역 제외), 안산시, 용인시, 김포시, 광주시', '6천만원', '2천만원'], ['그 밖의 지역', '4천500만원', '1천500만원']] }
  ];
  function smallTenantFor(date) {
    if (!date) return SMALL_TENANT[0];
    for (var i = 0; i < SMALL_TENANT.length; i++) if (date >= SMALL_TENANT[i].from) return SMALL_TENANT[i];
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* 1. PDF 추출                                                          */
  /* ------------------------------------------------------------------ */
  function mul(m1, m2) {
    return [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
  }
  function ap(p, m) { return [p[0] * m[0] + p[1] * m[2] + m[4], p[0] * m[1] + p[1] * m[3] + m[5]]; }
  function colorOf(a) {
    if (!a) return [0, 0, 0];
    if (typeof a[0] === 'string' && a[0].charAt(0) === '#') {
      var h = a[0];
      return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
    }
    var r = +a[0], g = +a[1], b = +a[2];
    if (r <= 1 && g <= 1 && b <= 1 && (r % 1 || g % 1 || b % 1)) { r *= 255; g *= 255; b *= 255; }
    return [r, g, b];
  }
  function isRed(c) { return c[0] >= 140 && c[0] - Math.max(c[1], c[2]) >= 70; }

  function parsePath(OPS, a, segs) {
    var ops = a[0], c = a[1], j = 0, cur = null, start = null;
    segs = segs || [];
    for (var k = 0; k < ops.length; k++) {
      switch (ops[k]) {
        case OPS.moveTo: cur = [c[j], c[j + 1]]; start = cur; j += 2; break;
        case OPS.lineTo: var p = [c[j], c[j + 1]]; if (cur) segs.push({ t: 'L', a: cur, b: p }); cur = p; j += 2; break;
        case OPS.curveTo: cur = [c[j + 4], c[j + 5]]; j += 6; break;
        case OPS.curveTo2: case OPS.curveTo3: cur = [c[j + 2], c[j + 3]]; j += 4; break;
        case OPS.closePath: if (cur && start) segs.push({ t: 'L', a: cur, b: start }); cur = start; break;
        case OPS.rectangle: segs.push({ t: 'R', x: c[j], y: c[j + 1], w: c[j + 2], h: c[j + 3] }); j += 4; break;
        default: break;
      }
    }
    return segs;
  }

  function extractSegments(OPS, ol, vpT) {
    var fn = ol.fnArray, ar = ol.argsArray;
    var ctm = [1, 0, 0, 1, 0, 0], stack = [], stroke = [0, 0, 0], fill = [0, 0, 0], pending = null;
    var out = { strikes: [], hl: [], vl: [] };
    function addSeg(x1, y1, x2, y2, red) {
      var dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
      if (dy <= 1.5 && dx >= 4) (red ? out.strikes : out.hl).push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), y: (y1 + y2) / 2 });
      else if (dx <= 1.5 && dy >= 4 && !red) out.vl.push({ x: (x1 + x2) / 2, y1: Math.min(y1, y2), y2: Math.max(y1, y2) });
    }
    function emit(kind) {
      if (!pending) return;
      var full = mul(vpT, ctm);
      var red = kind === 'fill' ? isRed(fill) : kind === 'stroke' ? isRed(stroke) : (isRed(stroke) || isRed(fill));
      for (var i = 0; i < pending.length; i++) {
        var s = pending[i];
        if (s.t === 'L') { var a = ap(s.a, full), b = ap(s.b, full); addSeg(a[0], a[1], b[0], b[1], red); continue; }
        var p1 = ap([s.x, s.y], full), p2 = ap([s.x + s.w, s.y + s.h], full);
        var x1 = Math.min(p1[0], p2[0]), x2 = Math.max(p1[0], p2[0]), y1 = Math.min(p1[1], p2[1]), y2 = Math.max(p1[1], p2[1]);
        var w = x2 - x1, h = y2 - y1;
        if (kind !== 'stroke') {
          if (h <= 3.2 && w >= 4) addSeg(x1, (y1 + y2) / 2, x2, (y1 + y2) / 2, red);
          else if (w <= 3.2 && h >= 4) addSeg((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, red);
          else if (kind === 'both') { addSeg(x1, y1, x2, y1, red); addSeg(x1, y2, x2, y2, red); addSeg(x1, y1, x1, y2, red); addSeg(x2, y1, x2, y2, red); }
        } else { addSeg(x1, y1, x2, y1, red); addSeg(x1, y2, x2, y2, red); addSeg(x1, y1, x1, y2, red); addSeg(x2, y1, x2, y2, red); }
      }
    }
    for (var i = 0; i < fn.length; i++) {
      var f = fn[i], a = ar[i];
      switch (f) {
        case OPS.save: stack.push([ctm, stroke, fill]); break;
        case OPS.restore: if (stack.length) { var st = stack.pop(); ctm = st[0]; stroke = st[1]; fill = st[2]; } break;
        case OPS.transform: ctm = mul(ctm, a); break;
        case OPS.paintFormXObjectBegin: stack.push([ctm, stroke, fill]); if (a && a[0] && a[0].length === 6) ctm = mul(ctm, a[0]); break;
        case OPS.paintFormXObjectEnd: if (stack.length) { var s2 = stack.pop(); ctm = s2[0]; stroke = s2[1]; fill = s2[2]; } break;
        case OPS.setStrokeRGBColor: stroke = colorOf(a); break;
        case OPS.setFillRGBColor: fill = colorOf(a); break;
        case OPS.constructPath: pending = parsePath(OPS, a, pending); break;
        case OPS.stroke: case OPS.closeStroke: emit('stroke'); pending = null; break;
        case OPS.fill: case OPS.eoFill: emit('fill'); pending = null; break;
        case OPS.fillStroke: case OPS.eoFillStroke: case OPS.closeFillStroke: case OPS.closeEOFillStroke: emit('both'); pending = null; break;
        case OPS.endPath: pending = null; break;
        default: break;
      }
    }
    return out;
  }

  async function extractPdf(pdfjsLib, data, onProgress) {
    var pdf = await pdfjsLib.getDocument({ data: data, isEvalSupported: false }).promise;
    var pages = [], chars = 0;
    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var vp = page.getViewport({ scale: 1 });
      var tc = await page.getTextContent();
      var items = [];
      for (var i = 0; i < tc.items.length; i++) {
        var it = tc.items[i];
        if (!it.str || !it.str.trim()) continue;
        var t = pdfjsLib.Util.transform(vp.transform, it.transform);
        var h = Math.hypot(t[2], t[3]) || it.height || 8;
        items.push({ s: it.str, x: t[4], y: t[5], w: it.width || h * it.str.length * 0.9, h: h });
        chars += it.str.replace(/\s+/g, '').length;
      }
      var segs = { strikes: [], hl: [], vl: [] };
      try { segs = extractSegments(pdfjsLib.OPS, await page.getOperatorList(), vp.transform); } catch (e) { /* 선 정보 없이 진행 */ }
      pages.push({ n: p, w: vp.width, h: vp.height, items: items, segs: segs });
      if (onProgress) onProgress(p, pdf.numPages);
    }
    return { pdf: pdf, pages: pages, chars: chars };
  }

  /* ------------------------------------------------------------------ */
  /* 2. 줄 복원                                                           */
  /* ------------------------------------------------------------------ */
  function struckRatio(it, strikes) {
    if (!strikes || !strikes.length) return 0;
    var top = it.y - it.h * 0.95, bot = it.y + it.h * 0.3, best = 0;
    for (var i = 0; i < strikes.length; i++) {
      var s = strikes[i];
      if (s.y < top || s.y > bot) continue;
      var ov = Math.min(it.x + it.w, s.x2) - Math.max(it.x, s.x1);
      if (ov > 0) best = Math.max(best, ov / Math.max(it.w, 1));
    }
    return best;
  }
  function joinItems(items) {
    var out = '', prev = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (prev) {
        var gap = it.x - (prev.x + prev.w);
        if (gap > Math.max(prev.h, it.h) * 0.22) out += ' ';
      }
      out += it.s; prev = it;
    }
    return out;
  }
  function buildLines(page) {
    var its = page.items.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var lines = [];
    for (var i = 0; i < its.length; i++) {
      var it = its[i], L = lines[lines.length - 1];
      var tol = Math.max(1.5, Math.min(it.h, L ? L.h : it.h) * 0.45);
      if (L && Math.abs(it.y - L.y) <= tol) { L.items.push(it); L.h = Math.max(L.h, it.h); }
      else lines.push({ y: it.y, h: it.h, items: [it] });
    }
    lines.forEach(function (L) {
      L.items.sort(function (a, b) { return a.x - b.x; });
      L.items.forEach(function (it) { it.k = struckRatio(it, page.segs.strikes) >= 0.5; });
      L.text = joinItems(L.items);
      L.ns = NS(L.text);
      L.page = page.n;
      L.yc = L.y - L.h * 0.35;
    });
    page.lines = lines;
    return lines;
  }

  /* ------------------------------------------------------------------ */
  /* 3. 표 머리행과 칸                                                     */
  /* ------------------------------------------------------------------ */
  var TABLES = [
    { key: 'rights', labels: ['순위번호', '등기목적', '접수', '등기원인', '권리자및기타사항'] },
    { key: 's_item', labels: ['순위번호', '등기목적', '접수정보', '주요등기사항', '대상소유자'] },
    { key: 's_owner', labels: ['등기명의인', '(주민)등록번호', '최종지분', '주소', '순위번호'] },
    { key: 'p_bldg1', labels: ['표시번호', '접수', '소재지번,건물명칭및번호', '건물내역', '등기원인및기타사항'] },
    { key: 'p_bldg', labels: ['표시번호', '접수', '소재지번및건물번호', '건물내역', '등기원인및기타사항'] },
    { key: 'p_unit', labels: ['표시번호', '접수', '건물번호', '건물내역', '등기원인및기타사항'] },
    { key: 'p_land', labels: ['표시번호', '접수', '소재지번', '지목', '면적', '등기원인및기타사항'] },
    { key: 'p_landof', labels: ['표시번호', '소재지번', '지목', '면적', '등기원인및기타사항'] },
    { key: 'p_daeji', labels: ['표시번호', '대지권종류', '대지권비율', '등기원인및기타사항'] }
  ];

  function charMap(L) {
    var s = '', xs = [], xe = [];
    L.items.forEach(function (it) {
      var raw = it.s, n = raw.length || 1, cw = it.w / n;
      for (var i = 0; i < raw.length; i++) {
        if (/\s/.test(raw[i])) continue;
        s += raw[i]; xs.push(it.x + i * cw); xe.push(it.x + (i + 1) * cw);
      }
    });
    return { s: s, xs: xs, xe: xe };
  }
  function matchHeader(L) {
    if (!/순위번호|표시번호|등기명의인/.test(L.ns)) return null;
    var cm = charMap(L), best = null;
    TABLES.forEach(function (def) {
      var pos = 0, found = [];
      def.labels.forEach(function (lab, idx) {
        var k = cm.s.indexOf(lab, pos);
        if (k >= 0) { found.push({ idx: idx, label: lab, x0: cm.xs[k], x1: cm.xe[k + lab.length - 1] }); pos = k + lab.length; }
      });
      var score = found.length / def.labels.length;
      if (found.length >= Math.min(3, def.labels.length) && found[0].idx === 0 &&
        (!best || score > best.score || (score === best.score && found.length > best.found.length))) best = { def: def, found: found, score: score };
    });
    return best;
  }

  function columnsFor(block, pageOf) {
    var hdr = block.header, found = block.match.found, pg = pageOf[hdr.page];
    var yc = hdr.yc;
    // (가) 세로 격자선
    var xs = [];
    (pg.segs.vl || []).forEach(function (v) { if (v.y1 <= yc + 1 && v.y2 >= yc - 1) xs.push(v.x); });
    xs.sort(function (a, b) { return a - b; });
    var ux = [];
    xs.forEach(function (x) { if (!ux.length || x - ux[ux.length - 1] > 2) ux.push(x); });
    if (ux.length >= found.length) {
      var cols = [], ok = true, used = {};
      found.forEach(function (f) {
        var c = (f.x0 + f.x1) / 2, k = -1;
        for (var i = 0; i < ux.length - 1; i++) if (c > ux[i] && c < ux[i + 1]) { k = i; break; }
        if (k < 0 || used[k]) ok = false; else { used[k] = 1; cols.push({ label: f.label, idx: f.idx, x0: ux[k], x1: ux[k + 1] }); }
      });
      if (ok) {
        cols[0].x0 = -1e9; cols[cols.length - 1].x1 = 1e9;
        for (var j = 1; j < cols.length; j++) { var mid = cols[j].x0; cols[j - 1].x1 = mid; }
        block.colSource = 'grid';
        return cols;
      }
    }
    // (나) 본문 글자 공백 분석
    var items = [];
    block.lines.forEach(function (L) { items = items.concat(L.items); });
    var cols2 = found.map(function (f) { return { label: f.label, idx: f.idx, x0: 0, x1: 0 }; });
    for (var k2 = 0; k2 < found.length - 1; k2++) {
      var lo = found[k2].x1 - 2, hi = found[k2 + 1].x0 + 2, bestRun = null, run = null;
      for (var x = lo; x <= hi; x += 0.5) {
        var cross = 0;
        for (var m = 0; m < items.length; m++) { var it = items[m]; if (it.x < x - 0.3 && it.x + it.w > x + 0.3) cross++; }
        if (!run || run.c !== cross) { run = { c: cross, a: x, b: x }; } else run.b = x;
        if (!bestRun || run.c < bestRun.c || (run.c === bestRun.c && run.b - run.a > bestRun.b - bestRun.a)) bestRun = { c: run.c, a: run.a, b: run.b };
      }
      var bnd = bestRun ? (bestRun.a + bestRun.b) / 2 : (found[k2].x1 + found[k2 + 1].x0) / 2;
      cols2[k2].x1 = bnd; cols2[k2 + 1].x0 = bnd;
    }
    cols2[0].x0 = -1e9; cols2[cols2.length - 1].x1 = 1e9;
    block.colSource = 'gap';
    return cols2;
  }

  function cellsOf(lines, cols) {
    var cells = cols.map(function () { return { lines: [], chars: 0, struck: 0 }; });
    lines.forEach(function (L) {
      var parts = cols.map(function () { return []; });
      L.items.forEach(function (it) {
        var c = it.x + it.w / 2;
        for (var i = 0; i < cols.length; i++) if (c >= cols[i].x0 && c < cols[i].x1) { parts[i].push(it); break; }
      });
      parts.forEach(function (arr, i) {
        if (!arr.length) return;
        var txt = joinItems(arr), n = NS(txt).length, k = 0;
        arr.forEach(function (it) { if (it.k) k += NS(it.s).length; });
        cells[i].lines.push({ t: txt, k: n ? k / n : 0 });
        cells[i].chars += n; cells[i].struck += k;
      });
    });
    return cells.map(function (c) {
      return { text: c.lines.map(function (l) { return l.t; }).join('\n'), lines: c.lines, struck: c.chars ? c.struck / c.chars : 0 };
    });
  }

  var RANK_RE = /^(\d{1,4}(?:-\d{1,3})?)(?:\(전[\d\-]+\))?$/;
  function rowsFor(block, pageOf, cols) {
    // 쪽마다 긴 가로 격자선이 있으면 그 사이를 한 행으로, 없으면 첫 칸 번호로 행을 나눈다.
    var byPage = {};
    block.lines.forEach(function (L) { (byPage[L.page] = byPage[L.page] || []).push(L); });
    var rows = [];
    Object.keys(byPage).map(Number).sort(function (a, b) { return a - b; }).forEach(function (pn) {
      var ls = byPage[pn], pg = pageOf[pn];
      var top = Math.min.apply(null, ls.map(function (l) { return l.yc; })) - 30, bot = Math.max.apply(null, ls.map(function (l) { return l.yc; })) + 30;
      var hys = (pg.segs.hl || []).filter(function (h) { return h.x2 - h.x1 >= pg.w * 0.45 && h.y > top && h.y < bot; })
        .map(function (h) { return h.y; }).sort(function (a, b) { return a - b; });
      var uy = [];
      hys.forEach(function (y) { if (!uy.length || y - uy[uy.length - 1] > 1.5) uy.push(y); });
      if (uy.length >= 2) {
        var bands = {};
        ls.forEach(function (L) {
          var b = 0; while (b < uy.length && uy[b] < L.yc) b++;
          (bands[b] = bands[b] || []).push(L);
        });
        Object.keys(bands).map(Number).sort(function (a, b) { return a - b; }).forEach(function (b) { rows.push({ page: pn, lines: bands[b], mode: 'grid' }); });
      } else {
        ls.forEach(function (L) {
          var first = cellsOf([L], cols)[0];
          var startsNew = RANK_RE.test(NS(first.text)) || (block.match.def.key === 's_owner' && NS(first.text));
          if (startsNew || !rows.length || rows[rows.length - 1].page !== pn) rows.push({ page: pn, lines: [L], mode: 'rank', fresh: !!startsNew });
          else rows[rows.length - 1].lines.push(L);
        });
      }
    });
    return rows;
  }

  /* ------------------------------------------------------------------ */
  /* 4. 문서 구조                                                         */
  /* ------------------------------------------------------------------ */
  function parseDate(s) {
    var t = NS(s), m = t.match(/(\d{4})년(\d{1,2})월(\d{1,2})일/) || t.match(/(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
    if (!m) return null;
    return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  }

  function parseDocument(pages) {
    var pageOf = {};
    pages.forEach(function (pg) { if (!pg.lines) buildLines(pg); pageOf[pg.n] = pg; });
    var doc = {
      title: '', kind: '', address: '', uniqueNo: '', viewedAt: null, viewedAtText: '', office: '',
      viewOnly: false, issued: false, partial: false, pages: pages.length,
      pyoje: [], gap: [], eul: [], empty: {}, summary: null, blocks: [], loose: [], notes: []
    };
    var section = 'pre', sub = '', cur = null;
    pages.forEach(function (pg) {
      pg.lines.forEach(function (L) {
        var ns = L.ns, m;
        if (!ns) return;
        if ((m = ns.match(/등기사항(전부|일부)증명서(?:\(([^)]*)\))?(?:-?(집합건물|건물|토지))?/))) {
          if (!doc.title) doc.title = L.text.trim();
          if (m[1] === '일부') doc.partial = true;
          if (m[3] && !doc.kind) doc.kind = m[3];
          return;
        }
        if ((m = ns.match(/^\[(집합건물|건물|토지)\](.*)$/))) {
          if (!doc.kind) doc.kind = m[1];
          if (!doc.address) doc.address = L.text.replace(/^\s*\[[^\]]*\]\s*/, '').replace(/\s*고\s*유\s*번\s*호.*$/, '').trim();
          var um = ns.match(/고유번호:?([\d\-]+)/); if (um && !doc.uniqueNo) doc.uniqueNo = um[1];
          return;
        }
        if ((m = ns.match(/^고유번호:?([\d\-]+)/))) { doc.uniqueNo = m[1]; return; }
        if (/열람일시/.test(ns)) {
          doc.viewedAtText = L.text.replace(/^.*열람일시\s*:?\s*/, '').replace(/\s+\d{1,3}\s*\/\s*\d{1,3}\s*$/, '').trim();
          doc.viewedAt = parseDate(ns.replace(/^.*열람일시/, ''));
          return;
        }
        if (/발행일|발급일시/.test(ns) && /\d{4}/.test(ns)) { doc.issued = true; if (!doc.viewedAt) { doc.viewedAt = parseDate(ns); doc.viewedAtText = L.text.trim(); } return; }
        if (/^\d{1,3}\/\d{1,3}$/.test(ns)) return;
        if (/처리중/.test(ns) && /신청/.test(ns)) { doc.pending = true; return; }
        if (/열람용/.test(ns) && /효력/.test(ns)) { doc.viewOnly = true; return; }
        if (/바코드|발급확인번호|위변조/.test(ns)) { doc.issued = true; return; }
        if (/관할등기소/.test(ns)) { doc.office = L.text.replace(/^.*관할등기소\s*/, '').trim(); return; }
        if (/실선으로그어진|기록사항없는갑구/.test(ns)) return;
        if (/이하여백/.test(ns)) { section = 'post'; cur = null; return; }
        if (/주요등기사항요약/.test(ns)) { section = 'summary'; sub = ''; cur = null; doc.summary = doc.summary || { owners: [], gap: [], eul: [], empty: {} }; return; }
        if (/[【\[]표제부[】\]]/.test(ns)) { section = 'pyoje'; sub = ((ns.match(/\(([^)]*)\)/) || [])[1] || ''); cur = null; return; }
        if ((m = ns.match(/^\(([^)]*(?:의표시|건물의표시|토지의표시))\)$/))) { section = 'pyoje'; sub = m[1]; cur = null; return; }
        if (/[【\[]갑구[】\]]/.test(ns)) { section = 'gap'; sub = ''; cur = null; return; }
        if (/[【\[]을구[】\]]/.test(ns)) { section = 'eul'; sub = ''; cur = null; return; }
        if (section === 'summary') {
          if (/^1\.소유지분현황/.test(ns)) { sub = 'owners'; cur = null; return; }
          if (/^2\.소유지분을제외한/.test(ns)) { sub = 'gap'; cur = null; return; }
          if (/^3\.\(근\)저당권/.test(ns)) { sub = 'eul'; cur = null; return; }
          if (/주의사항|증명서로서의기능|필수적으로확인/.test(ns)) return;
          if (/^\[?참고사항|^[가-하]\.|정확한권리사항|확인불가/.test(ns)) { cur = null; return; }
        }
        if (/기록사항없음/.test(ns)) {
          if (section === 'summary') doc.summary.empty[sub] = true; else doc.empty[section] = true;
          return;
        }
        var mh = matchHeader(L);
        if (mh) { cur = { section: section, sub: sub, match: mh, header: L, lines: [] }; doc.blocks.push(cur); return; }
        if (cur && section !== 'pre' && section !== 'post') cur.lines.push(L);
        else doc.loose.push(L);
      });
    });

    doc.blocks.forEach(function (b) {
      b.cols = columnsFor(b, pageOf);
      b.rows = rowsFor(b, pageOf, b.cols);
      var key = b.match.def.key;
      var target = null;
      if (key === 'rights' && (b.section === 'gap' || b.section === 'eul')) target = doc[b.section];
      else if (b.section === 'summary' && key === 's_owner') target = doc.summary.owners;
      else if (b.section === 'summary' && key === 's_item') target = doc.summary[b.sub === 'eul' ? 'eul' : 'gap'];
      else if (b.section === 'pyoje') target = doc.pyoje;
      if (!target) return;
      b.rows.forEach(function (r) {
        var cells = cellsOf(r.lines, b.cols);
        var firstNS = NS(cells[0].text);
        var isNew = key === 's_owner' ? !!firstNS : /^\d/.test(firstNS);
        var last = target[target.length - 1];
        if (!isNew && last && last._key === key) { mergeCells(last, cells, r); return; }
        if (!isNew && !last) return;
        var rec = { _key: key, sub: b.sub, cols: b.cols.map(function (c) { return c.label; }), cells: cells, page: r.page, pages: [r.page] };
        target.push(rec);
      });
    });

    doc.gap = doc.gap.map(function (r) { return toEntry(r, 'gap'); });
    doc.eul = doc.eul.map(function (r) { return toEntry(r, 'eul'); });
    if (doc.summary) {
      doc.summary.gap = doc.summary.gap.map(toSummaryItem);
      doc.summary.eul = doc.summary.eul.map(toSummaryItem);
      doc.summary.owners = doc.summary.owners.map(toSummaryOwner).filter(function (o) { return o.name; });
    }
    doc.pyojeText = doc.pyoje.map(function (r) { return '(' + r.sub + ') ' + r.cells.map(function (c) { return c.text.replace(/\n/g, ' '); }).join(' | '); }).join('\n');
    doc.allText = pages.map(function (pg) { return pg.lines.map(function (l) { return l.text; }).join('\n'); }).join('\n\n');
    return doc;
  }

  function mergeCells(rec, cells, r) {
    rec.cells.forEach(function (c, i) {
      var add = cells[i];
      if (!add || !add.text) return;
      var n1 = NS(c.text).length, n2 = NS(add.text).length;
      c.text = c.text ? c.text + '\n' + add.text : add.text;
      c.lines = c.lines.concat(add.lines);
      c.struck = (n1 + n2) ? (c.struck * n1 + add.struck * n2) / (n1 + n2) : 0;
    });
    if (rec.pages.indexOf(r.page) < 0) rec.pages.push(r.page);
  }

  function toEntry(r, sec) {
    var c = r.cells;
    var rankRaw = NS(c[0] ? c[0].text : '');
    var rm = rankRaw.match(/^(\d{1,4}(?:-\d{1,3})?)(\(전[\d\-]+\))?/);
    var e = {
      sec: sec, rank: rm ? rm[1] : rankRaw, rankNote: rm && rm[2] ? rm[2] : '',
      purpose: (c[1] && c[1].text) || '', receipt: (c[2] && c[2].text) || '', cause: (c[3] && c[3].text) || '', holder: (c[4] && c[4].text) || '',
      holderLines: (c[4] && c[4].lines) || [], struckPurpose: c[1] ? c[1].struck : 0,
      struckAll: avgStruck(c), page: r.page, pages: r.pages
    };
    return e;
  }
  function avgStruck(cells) {
    var n = 0, k = 0;
    cells.forEach(function (c) { var m = NS(c.text).length; n += m; k += c.struck * m; });
    return n ? k / n : 0;
  }
  function toSummaryItem(r) {
    var c = r.cells;
    var rank = (NS(c[0] && c[0].text).match(/^\d{1,4}(?:-\d{1,3})?/) || [''])[0];
    return { rank: rank, purpose: c[1] ? c[1].text : '', receipt: c[2] ? c[2].text : '', main: c[3] ? c[3].text : '', owner: c[4] ? c[4].text : '' };
  }
  function toSummaryOwner(r) {
    var c = r.cells;
    return { name: (c[0] && c[0].text || '').replace(/\s*\n\s*/g, ' ').replace(/\s*\([가-힣]*자\)\s*/g, '').trim(), role: /공유자/.test(c[0] && c[0].text) ? '공유자' : /수탁자/.test(c[0] && c[0].text) ? '수탁자' : '소유자', regno: c[1] ? (NS(c[1].text).match(/\d{6}-[\d*]{7}/) || [NS(c[1].text)])[0] : '', share: c[2] ? (NS(c[2].text).match(/단독소유|\d+분의\d+|[\d.]+%|공유|확인불가/) || [NS(c[2].text).slice(0, 20)])[0] : '', address: c[3] ? c[3].text.replace(/\n/g, ' ') : '', rank: c[4] ? NS(c[4].text) : '' };
  }

  /* ------------------------------------------------------------------ */
  /* 5. 등기 해석                                                         */
  /* ------------------------------------------------------------------ */
  var TYPES = [
    ['restore', /말소회복/],
    ['cancel', /\d+(?:-\d+)?번.*말소$|등기말소$/],
    ['prov_reg', /가등기/],
    ['injunction', /가처분/],
    ['attach', /가압류/],
    ['mgmt', /강제관리/],
    ['auction', /경매개시결정/],
    ['public_sale', /공매공고/],
    ['seizure', /압류/],
    ['trust', /신탁/],
    ['repurchase', /환매/],
    ['warning', /예고등기/],
    ['rehab', /회생|파산|부인의등기|^부인$/],
    ['prohibit', /금지사항/],
    ['preserve', /소유권보존/],
    ['transfer', /소유권이전|소유권일부이전|지분(전부|일부)?이전|공유자전원지분/],
    ['name_change', /표시변경|표시경정/],
    ['m_transfer', /근?저당권(일부)?이전/],
    ['m_change', /근?저당권변경/],
    ['pledge', /질권/],
    ['jeonse_mort', /전세권(근)?저당권/],
    ['mortgage', /근?저당권/],
    ['jeonse', /전세권/],
    ['lease', /임차권/],
    ['superficies', /지상권/],
    ['easement', /지역권/],
    ['correction', /경정/]
  ];
  var TYPE_LABEL = {
    restore: '말소회복', cancel: '말소등기', prov_reg: '가등기', injunction: '가처분', attach: '가압류', auction: '경매개시결정',
    public_sale: '공매공고', seizure: '압류', trust: '신탁', repurchase: '환매특약', warning: '예고등기', rehab: '회생·파산',
    prohibit: '금지사항', preserve: '소유권보존', transfer: '소유권이전', name_change: '표시변경', m_transfer: '근저당권 이전',
    m_change: '근저당권 변경', pledge: '근저당권부 질권', mortgage: '근저당권', jeonse: '전세권', lease: '임차권', superficies: '지상권',
    easement: '지역권', correction: '경정', mgmt: '강제관리', jeonse_mort: '전세권부 근저당', other: '기타'
  };
  var RIGHT_TYPES = { mgmt: 1, jeonse_mort: 1, prov_reg: 1, injunction: 1, attach: 1, auction: 1, public_sale: 1, seizure: 1, trust: 1, repurchase: 1, warning: 1, rehab: 1, prohibit: 1, mortgage: 1, jeonse: 1, lease: 1, superficies: 1, easement: 1, pledge: 1 };

  function amountsIn(lines) {
    var out = [];
    lines.forEach(function (l) {
      var t = NS(l.t), re = /(채권최고액|청구금액|전세금|임차보증금|보증금|거래가액|차임|채권액|매매대금)금?([\d,]+)원/g, m;
      while ((m = re.exec(t))) out.push({ label: m[1], value: +m[2].replace(/,/g, ''), struck: l.k >= 0.5 });
    });
    return out;
  }
  function pickAmount(amts, labels) {
    var live = amts.filter(function (a) { return labels.indexOf(a.label) >= 0 && !a.struck; });
    if (live.length) return live[live.length - 1].value;
    var any = amts.filter(function (a) { return labels.indexOf(a.label) >= 0; });
    return any.length ? any[any.length - 1].value : null;
  }
  var ROLE_RE = /^(근저당권자|저당권자|채권자|권리자|소유자|공유자|수탁자|위탁자|전세권자|임차권자|지상권자|지역권자|가등기권자|질권자|채무자|환매권자)/;
  function roleNames(lines) {
    var out = [], role = '', pendingShare = '';
    lines.forEach(function (l) {
      var t = l.t.trim(), m = NS(t).match(ROLE_RE);
      if (m) { role = m[1]; t = t.replace(/^\s*\S+?(자)\s*/, ''); t = t.replace(new RegExp('^' + m[1].split('').join('\\s*') + '\\s*'), ''); }
      var sm = t.match(/지분\s*([0-9]+\s*분의\s*[0-9]+)/);
      if (sm) { pendingShare = NS(sm[1]); t = t.replace(sm[0], '').trim(); }
      var rg = t.match(/(\d{6}-[\d*]{7})/);
      if (!role) return;
      var name = rg ? t.slice(0, t.indexOf(rg[1])).trim() : '';
      if (rg && name) {
        out.push({ role: role, name: name.replace(/\s+/g, ' '), regno: rg[1], share: pendingShare, struck: l.k >= 0.5 });
        pendingShare = '';
      } else if (!rg && t && !out.some(function (o) { return o.role === role; }) && /^(주식회사|유한회사|㈜|\(주\)|[가-힣]+(은행|공단|공사|조합|금고|세무서|시|군|구|도|청|회사|신탁|캐피탈|대부|보험|재단|협회)$)/.test(NS(t))) {
        out.push({ role: role, name: t.replace(/\s+/g, ' '), regno: '', share: pendingShare, struck: l.k >= 0.5 });
      }
    });
    return out;
  }
  function lenderTier(name, regno) {
    var n = NS(name);
    if (!n) return '';
    if (/대부/.test(n)) return '대부업체';
    if (/유동화|에이엠씨|AMC|자산관리|에프앤아이|F&I|엔피엘|NPL/i.test(n)) return '채권 유동화·추심 회사';
    if (/저축은행|캐피탈|카드|보험|새마을금고|신용협동조합|신협|농업협동조합|축산업협동조합|수산업협동조합|산림조합|증권|상호저축/.test(n) && !/농협은행|수협은행/.test(n)) return '제2금융권';
    if (/은행/.test(n)) return '은행';
    if (/주택금융공사|주택도시보증공사|한국자산관리공사|기금/.test(n)) return '공공기관';
    if (/^[가-힣]{2,4}$/.test(n) && /\*/.test(regno || '*')) return '개인';
    if (/주식회사|㈜|\(주\)|유한회사|법인|회사/.test(n)) return '기타 법인';
    return /\*/.test(regno || '') ? '개인' : '';
  }
  function seizureHolderType(name) {
    var n = NS(name);
    if (/국민건강보험공단|국민연금공단|근로복지공단/.test(n)) return '4대 사회보험';
    if (/세무서|국세청|대한민국|국$/.test(n)) return '국세';
    if (/(특별시|광역시|특별자치시|도|시|군|구)$|시청|구청|군청/.test(n)) return '지방세·지자체';
    if (/공단|공사/.test(n)) return '공공기관';
    return '';
  }
  function isCorp(name, regno) {
    return /주식회사|㈜|\(주\)|유한회사|합자회사|합명회사|법인|조합|재단|공사|공단/.test(NS(name)) || (/^\d{6}-\d{7}$/.test(regno || '') && !/\*/.test(regno));
  }

  function classify(e) {
    var p = NS(e.purpose);
    e.cancelled = false; e.cancelSrc = ''; e.cancelledBy = ''; e.cancelDate = ''; e.cancelCause = ''; e.restoredBy = ''; e.summaryNote = ''; e.subs = null; e.main = null;
    e.type = 'other';
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i][1].test(p)) { e.type = TYPES[i][0]; break; }
    e.date = parseDate(e.receipt);
    var rn = NS(e.receipt).match(/제([\d,]+)호/); e.no = rn ? +rn[1].replace(/,/g, '') : 0;
    e.causeDate = parseDate(e.cause);
    e.causeText = NS(e.cause).replace(/\d{4}년\d{1,2}월\d{1,2}일/, '');
    e.parent = /-/.test(e.rank) ? e.rank.split('-')[0] : null;
    e.targets = [];
    if (e.type === 'cancel' || e.type === 'restore' || e.type === 'm_change' || e.type === 'm_transfer' || e.type === 'name_change' || e.type === 'pledge' || e.type === 'jeonse_mort') {
      var re = /(\d+(?:-\d+)?)번/g, m;
      while ((m = re.exec(p))) e.targets.push(m[1]);
    }
    e.amounts = amountsIn(e.holderLines);
    e.names = roleNames(e.holderLines);
    e.bonDeunggi = e.type === 'prov_reg' && /소유권이전/.test(p.replace(/소유권이전(청구권|담보)?가등기/, ''));
    e.caseNo = (e.cause.match(/\((\d{4}(?:카|타경|가|머|즈|느|본|드)[가-힣]*\d+)\)/) || e.cause.replace(/\s/g, '').match(/(\d{4}(?:카단|카합|카기|타경)\d+)/) || [])[1] || '';
    return e;
  }

  function resolveStatus(list, summaryRanks) {
    var byRank = {};
    list.forEach(function (e) { byRank[e.rank] = e; });
    list.forEach(function (e) {
      if (e.type === 'cancel') e.targets.forEach(function (t) { var x = byRank[t]; if (x && x !== e) { x.cancelled = true; x.cancelSrc = 'entry'; x.cancelledBy = e.rank; x.cancelDate = e.date; x.cancelCause = e.causeText; } });
    });
    list.forEach(function (e) {
      if (e.type === 'restore') e.targets.forEach(function (t) { var x = byRank[t]; if (x) { x.cancelled = false; x.cancelSrc = ''; x.restoredBy = e.rank; } });
    });
    list.forEach(function (e) {
      e.visualStruck = e.struckPurpose >= 0.6 || (e.struckAll >= 0.6 && e.struckPurpose >= 0.3);
      if (!e.cancelled && e.visualStruck && e.type !== 'cancel') { e.cancelled = true; e.cancelSrc = 'line'; }
      if (e.parent && byRank[e.parent] && byRank[e.parent].cancelled && !e.cancelled && e.type !== 'cancel') { e.cancelled = true; e.cancelSrc = 'parent'; e.cancelledBy = byRank[e.parent].cancelledBy; }
    });
    if (summaryRanks) {
      list.forEach(function (e) {
        if (!RIGHT_TYPES[e.type] || e.parent) return;
        var listed = summaryRanks.indexOf(e.rank) >= 0;
        if (listed && e.cancelled) e.summaryNote = '주요 등기사항 요약에는 유효 사항으로 남아 있습니다';
        if (!listed && !e.cancelled) { e.cancelled = true; e.cancelSrc = 'summary'; e.summaryNote = '주요 등기사항 요약에 없어 말소된 것으로 추정했습니다'; }
      });
    }
    list.forEach(function (e) {
      e.status = e.cancelled ? '말소' : '유효';
      e.statusWhy = !e.cancelled ? '' : e.cancelSrc === 'entry' ? e.cancelledBy + '번 말소등기' : e.cancelSrc === 'line' ? '말소 실선' : e.cancelSrc === 'parent' ? '주등기 말소' : '요약표 미기재(추정)';
    });
    // 부기(변경·이전)를 주등기에 묶는다
    list.forEach(function (e) {
      var tgt = e.parent ? byRank[e.parent] : (e.targets.length && (e.type === 'm_change' || e.type === 'm_transfer' || e.type === 'pledge') ? byRank[e.targets[0]] : null);
      if (tgt && tgt !== e) { (tgt.subs = tgt.subs || []).push(e); e.main = tgt.rank; }
    });
  }

  function ownersFromGap(gap) {
    var owners = [], notes = [];
    gap.slice().sort(function (a, b) { return rankKey(a.rank) - rankKey(b.rank); }).forEach(function (e) {
      if (e.cancelled) return;
      var trustXfer = e.type === 'trust' && /소유권이전/.test(NS(e.purpose));
      if (e.type !== 'preserve' && e.type !== 'transfer' && !trustXfer && !(e.type === 'prov_reg' && e.bonDeunggi)) return;
      var holders = e.names.filter(function (n) { return (n.role === '소유자' || n.role === '공유자' || (trustXfer && n.role === '수탁자')) && !n.struck; });
      if (!holders.length) return;
      var partial = /일부이전|지분/.test(NS(e.purpose));
      if (partial) { owners = owners.concat(holders.map(function (h) { return { name: h.name, regno: h.regno, share: h.share || '지분', rank: e.rank }; })); notes.push('지분 이전 포함'); }
      else owners = holders.map(function (h) { return { name: h.name, regno: h.regno, share: h.share || (holders.length > 1 ? '공유' : '단독소유'), rank: e.rank }; });
    });
    return { owners: owners, approx: notes.length > 0 };
  }
  function rankKey(r) { var p = String(r).split('-'); return (+p[0] || 0) * 1000 + (+p[1] || 0); }
  function dkey(e) { return (e.date || '9999-99-99') + '#' + ('000000000' + (e.no || 0)).slice(-9); }
  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function won(v) {
    if (v == null) return '';
    var eok = Math.floor(v / 100000000), man = Math.round((v % 100000000) / 10000);
    return (eok ? eok + '억' : '') + (man ? (eok ? ' ' : '') + man.toLocaleString('ko-KR') + '만' : '') + '원' + (eok || man ? '' : '');
  }

  /* ------------------------------------------------------------------ */
  /* 6. 특이사항                                                          */
  /* ------------------------------------------------------------------ */
  var LV = { critical: 4, high: 3, caution: 2, info: 1 };
  var LV_LABEL = { critical: '위험', high: '높음', caution: '주의', info: '참고' };
  var PURPOSES = { lease: '전세·월세 계약', buy: '매매(매수)', auction: '경매 입찰', credit: '담보·채권 회수', general: '일반 검토' };

  function analyze(doc, opt) {
    opt = opt || {};
    var purpose = opt.purpose || 'general';
    var base = opt.baseDate || ymd(new Date());
    var all = doc.gap.concat(doc.eul);
    all.forEach(classify);
    var sumGap = doc.summary && (doc.summary.gap.length || doc.summary.empty.gap) ? doc.summary.gap.map(function (s) { return s.rank; }) : null;
    var sumEul = doc.summary && (doc.summary.eul.length || doc.summary.empty.eul) ? doc.summary.eul.map(function (s) { return s.rank; }) : null;
    resolveStatus(doc.gap, sumGap);
    resolveStatus(doc.eul, sumEul);

    var flags = [];
    function F(id, level, title, o) {
      o = o || {};
      var f = { id: id, level: level, title: title, kind: o.kind || '사실', entries: o.entries || [], detail: o.detail || '', meaning: o.meaning || '', check: o.check || [], basis: o.basis || [], quote: o.quote || '' };
      if (o.entries && o.entries.length && !f.quote) f.quote = o.entries.map(function (e) { return (e.sec === 'gap' ? '갑구 ' : '을구 ') + e.rank + '번 ' + oneLine(e.purpose) + ' | ' + oneLine(e.receipt) + ' | ' + oneLine(e.cause) + ' | ' + oneLine(e.holder).slice(0, 140); }).join('\n');
      flags.push(f);
      return f;
    }
    function P(map) { return map[purpose] || map.general || ''; }
    function lv(map) { return map[purpose] || map.general; }

    var valid = function (t) { return all.filter(function (e) { return e.type === t && !e.cancelled; }); };
    var ever = function (t) { return all.filter(function (e) { return e.type === t; }); };

    /* 소유자 */
    var own = doc.summary && doc.summary.owners.length ? { owners: doc.summary.owners.map(function (o) { return { name: o.name, regno: o.regno, share: o.share, rank: o.rank }; }), approx: false, src: '주요 등기사항 요약' } : ownersFromGap(doc.gap);
    own.src = own.src || '갑구 계산';
    var owners = own.owners;

    /* 문서 자체 */
    if (doc.partial) F('partial', 'caution', '일부증명서(현재 유효사항)입니다', { meaning: '말소된 등기 이력이 표시되지 않아 과거 가압류·임차권등기 같은 이력을 볼 수 없습니다.', check: ['말소사항 포함 전부증명서로 다시 열람'] });
    if (doc.viewOnly) F('viewonly', 'info', '열람용 출력물입니다', { meaning: '문서 하단에 "열람용이므로 출력하신 등기사항증명서는 법적인 효력이 없습니다"라고 적혀 있습니다(문서 자체의 안내 문구). 제출용이 필요하면 발급본을 받아야 합니다.' });
    if (doc.viewedAt) {
      var age = daysBetween(doc.viewedAt, base);
      if (age >= 1) F('stale', age > 30 ? 'high' : 'caution', '열람 후 ' + age + '일이 지났습니다', { detail: '열람일시 ' + doc.viewedAtText + ', 판독 기준일 ' + base, meaning: '열람 이후 새 등기가 들어왔을 수 있습니다. 계약 당일과 잔금 직전에 다시 열람해 비교하는 것이 안전합니다.', check: ['계약일·잔금일 당일 재열람'] });
    } else F('noviewdate', 'info', '열람·발급 일시를 찾지 못했습니다', { meaning: '언제 기준의 등기부인지 확인할 수 없습니다.', check: ['최신 등기부 재열람'] });

    /* 표제부 */
    var pt = NS(doc.pyojeText);
    var unitPt = NS(doc.pyoje.filter(function (r) { return /전유/.test(r.sub); }).map(function (r) { return r.cells.map(function (c) { return c.text; }).join(' '); }).join(' '));
    var use = '';
    var USES = [['아파트', '아파트'], ['오피스텔', '오피스텔'], ['도시형생활주택', '도시형생활주택'], ['다세대주택', '다세대주택'], ['연립주택', '연립주택'], ['다가구주택', '다가구주택'], ['단독주택', '단독주택'], ['제1종근린생활시설', '제1종 근린생활시설'], ['제2종근린생활시설', '제2종 근린생활시설'], ['근린생활시설', '근린생활시설'], ['업무시설', '업무시설'], ['공동주택', '공동주택'], ['숙박시설', '숙박시설'], ['창고', '창고'], ['공장', '공장']];
    [unitPt, pt].some(function (src) { return src && USES.some(function (u) { if (src.indexOf(u[0]) >= 0) { use = u[1]; return true; } return false; }); });
    var area = (pt.match(/전유부분[^㎡]*?([\d.]+)㎡/) || [])[1] || '';
    if (!area) { var unit = doc.pyoje.filter(function (r) { return /전유/.test(r.sub); }).map(function (r) { return NS(r.cells.map(function (c) { return c.text; }).join(' ')); }).join(''); area = (unit.match(/([\d.]+)㎡/) || [])[1] || ''; }
    var daeji = doc.pyoje.filter(function (r) { return /대지권의표시/.test(r.sub); });
    var daejiRatio = daeji.length ? ((daeji.map(function (r) { return r.cells.map(function (c) { return c.text.replace(/\n/g, ' '); }).join(' | '); }).join(' ').match(/(\d[\d.,]*\s*분의\s*\d[\d.,]*)/) || [])[1] || '').replace(/\s+/g, '') : '';
    var daejiType = daeji.length ? ((NS(daeji[0].cells.map(function (c) { return c.text; }).join(' ')).match(/(소유권대지권|지상권대지권|전세권대지권|임차권대지권)/) || [])[1] || '') : '';
    if (/근린생활시설/.test(use)) F('use_neighborhood', lv({ lease: 'high', buy: 'caution', general: 'caution' }), '건물 용도가 근린생활시설로 기재되어 있습니다', { detail: '표제부 용도: ' + use, meaning: P({ lease: '주거용으로 쓰고 있다면 용도와 실제 사용이 다른 경우입니다. 건축물대장의 위반건축물 표시와 전세자금대출·보증보험 가입 가능 여부를 확인해야 합니다.', general: '주거용으로 사용 중인지, 건축물대장에 위반건축물 표시가 있는지 확인이 필요합니다.' }), check: ['건축물대장(위반건축물 표시, 용도)', '전세자금대출·보증보험 가능 여부'] });
    if (use === '오피스텔' || use === '업무시설') F('use_officetel', 'info', '용도가 ' + use + '입니다', { meaning: '주거용으로 쓰는지 업무용인지에 따라 세금·대출·보호 범위가 달라질 수 있어 실제 사용 형태를 확인해야 합니다.', check: ['건축물대장 용도', '전입 가능 여부'] });
    if (use === '다가구주택') F('use_multi', lv({ lease: 'high', general: 'caution' }), '다가구주택입니다(건물 전체가 하나의 등기)', { meaning: '호실별로 등기가 나뉘지 않아 다른 세대 임차인의 보증금과 전입·확정일자 순서가 내 보증금보다 앞설 수 있습니다.', check: ['전입세대 열람', '확정일자 부여 현황(임대인 동의)', '다른 임차인 보증금 합계'] });
    if (doc.kind === '집합건물' && doc.pyoje.length && !daeji.length) F('no_daeji', lv({ lease: 'caution', buy: 'high', auction: 'high', general: 'caution' }), '집합건물인데 대지권 표시가 없습니다', { meaning: '대지권이 아직 등기되지 않았거나(대지권 미등기) 대지권이 없는 건물일 수 있습니다. 토지 지분 소유 여부가 가격과 경매 결과에 영향을 줍니다.', check: ['토지 등기부', '분양계약서·분양대금 완납 여부', '집합건축물대장'] });
    if (/별도등기/.test(pt)) F('land_separate', lv({ lease: 'high', buy: 'high', auction: 'high', general: 'caution' }), '토지에 별도등기가 있다는 표시가 있습니다', { meaning: '대지에 건물과 별개로 근저당 등 권리가 설정되어 있을 수 있습니다. 토지 등기부의 내용과 금액을 따로 확인해야 합니다.', check: ['토지 등기부(별도등기 내용)'] });

    /* 소유자 관련 */
    var corpOwners = owners.filter(function (o) { return isCorp(o.name, o.regno); });
    if (corpOwners.length) F('corp_owner', 'caution', '소유자가 법인입니다', { detail: corpOwners.map(function (o) { return o.name; }).join(', '), meaning: '계약 상대방이 법인 대표자 또는 정당한 대리인인지, 법인 상태(해산·회생 등)를 확인해야 합니다.', check: ['법인 등기사항증명서', '대표자 신분증·위임장·법인인감증명서'] });
    if (owners.length > 1) F('co_owned', lv({ lease: 'high', buy: 'high', auction: 'caution', general: 'caution' }), '공유(지분) 소유입니다: ' + owners.length + '명', { detail: owners.map(function (o) { return o.name + ' ' + (o.share || ''); }).join(', '), meaning: P({ lease: '계약 상대방이 공유자 전원인지, 동의를 받았는지 확인해야 합니다.', buy: '매도인 전원이 계약에 참여하는지 확인해야 합니다.', auction: '지분만 매각되는 사건인지 확인해야 합니다.', general: '처분·임대에 공유자 동의가 필요한지 확인해야 합니다.' }), check: ['공유자 전원 신분 확인 또는 동의서'] });
    if (opt.partyName) {
      var pn = NS(opt.partyName);
      var hit = owners.some(function (o) { return NS(o.name).indexOf(pn) >= 0 || pn.indexOf(NS(o.name)) >= 0; });
      if (!hit && owners.length) F('party_mismatch', 'critical', '계약 상대방이 등기부상 소유자가 아닙니다', { detail: '입력한 상대방: ' + opt.partyName + ' / 등기부상 소유자: ' + owners.map(function (o) { return o.name; }).join(', '), meaning: '대리인이면 위임장과 인감증명서, 신탁이면 수탁자 동의서가 있어야 합니다. 권한 확인 없이 계약하면 안 됩니다.', check: ['소유자 본인 확인', '위임장·인감증명서'] });
    }

    /* 소유권 이전 흐름 */
    var xfers = doc.gap.filter(function (e) { return (e.type === 'transfer' || e.type === 'preserve' || (e.type === 'trust' && /소유권이전/.test(NS(e.purpose))) || (e.type === 'prov_reg' && e.bonDeunggi)) && e.date; }).sort(function (a, b) { return dkey(a) < dkey(b) ? -1 : 1; });
    var transfersOnly = xfers.filter(function (e) { return e.type !== 'preserve'; });
    var lastX = xfers[xfers.length - 1];
    if (lastX && lastX.type !== 'preserve') {
      var dd = daysBetween(lastX.date, base);
      if (dd >= 0 && dd <= 365) F('recent_transfer', lv({ lease: 'caution', buy: 'caution', general: 'caution', auction: 'info', credit: 'info' }), (dd < 60 ? dd + '일' : Math.round(dd / 30) + '개월') + ' 전에 소유자가 바뀌었습니다', { entries: [lastX], meaning: '새 소유자의 자금 사정과 이전 원인(' + (lastX.causeText || '원인 미상') + ')을 확인해야 합니다. 잔금과 함께 근저당이 설정됐는지도 함께 봅니다.', check: ['매매계약서·거래가액', '소유자 신분 확인'] });
    }
    var preserve = xfers.filter(function (e) { return e.type === 'preserve'; })[0];
    if (preserve && daysBetween(preserve.date, base) <= 730 && daysBetween(preserve.date, base) >= 0) F('new_build', lv({ lease: 'caution', buy: 'caution', general: 'info' }), '신축 건물입니다(소유권보존 ' + preserve.date + ')', { entries: [preserve], meaning: '거래 사례가 적어 시세 확인이 어렵습니다. 분양·임대 조건이 시세보다 높게 잡혔는지 비교가 필요합니다.', check: ['인근 실거래가', '감정평가 또는 공시가격'] });
    for (var i = 0; i < transfersOnly.length; i++) {
      var win = transfersOnly.filter(function (e) { var d = daysBetween(transfersOnly[i].date, e.date); return d >= 0 && d <= 730; });
      if (win.length >= 3) { F('frequent_transfer', lv({ lease: 'high', buy: 'high', general: 'caution', auction: 'caution' }), '2년 안에 소유권 이전이 ' + win.length + '회 있었습니다', { entries: win, kind: '추론', meaning: '단기간 반복 거래는 시세 부풀리기, 명의 이전을 통한 책임 회피 등 여러 사정이 있을 수 있습니다. 거래 경위를 확인해야 합니다.', check: ['각 거래가액 비교', '현 소유자와 이전 소유자 관계'] }); break; }
    }
    transfersOnly.forEach(function (e) {
      var c = e.causeText;
      if (/경매로인한매각|매각$|공매/.test(c)) F('acq_auction', 'info', '경매·공매로 취득한 이력이 있습니다(' + e.rank + '번)', { entries: [e], meaning: '과거 경매 이력은 당시 채무 문제가 있었다는 뜻입니다. 매각으로 말소된 권리와 인수된 권리가 정리됐는지 확인합니다.' });
      if (/판결|진정명의회복|화해|조정/.test(c)) F('acq_judgment', 'caution', '판결·화해 등으로 소유권이 이전된 이력이 있습니다(' + e.rank + '번)', { entries: [e], meaning: '소유권을 두고 다툼이 있었던 이력입니다. 확정 여부와 남은 분쟁을 확인합니다.', check: ['판결문·확정증명'] });
      if (/상속/.test(c)) {
        var next = transfersOnly.filter(function (x) { return dkey(x) > dkey(e); })[0];
        if (next && daysBetween(e.date, next.date) <= 365) F('inherit_sale', 'info', '상속 후 1년 안에 다시 이전됐습니다', { entries: [e, next], kind: '추론', meaning: '상속재산 정리 과정의 매각일 수 있습니다. 상속인 전원의 협의가 끝났는지 확인합니다.' });
      }
      if (/증여/.test(c) && daysBetween(e.date, base) <= 730) F('gift', 'info', '최근 2년 안에 증여로 소유권이 이전됐습니다(' + e.rank + '번)', { entries: [e], meaning: '가족 간 명의 이전일 수 있습니다. 증여 직후 담보 설정이나 매각이 이어졌는지 함께 봅니다.' });
    });

    /* 갑구 권리 */
    valid('auction').forEach(function (e) {
      F('auction', lv({ auction: 'info', general: 'critical', lease: 'critical', buy: 'critical', credit: 'high' }), (/임의/.test(e.purpose) ? '임의' : /강제/.test(e.purpose) ? '강제' : '') + '경매개시결정이 유효합니다' + (e.caseNo ? ' (' + e.caseNo + ')' : ''), { entries: [e], meaning: P({ auction: '입찰 대상 사건의 압류 등기입니다. 이 등기가 말소기준권리가 되는지 아래 계산과 함께 봅니다.', lease: '경매가 진행 중인 부동산입니다. 지금 임대차를 맺으면 매각 후 보증금 회수가 불확실해질 수 있습니다.', buy: '경매가 취하·취소되지 않으면 매각으로 소유권이 넘어갈 수 있습니다. 경매 정리 없이 계약하면 안 됩니다.', credit: '선행 경매가 진행 중입니다. 배당요구 종기와 배당 순위를 확인해야 합니다.', general: '법원이 경매절차를 시작해 압류 효력이 생긴 상태입니다.' }), check: ['법원경매정보 사건 조회(' + (e.caseNo || '사건번호') + ')', '매각기일·배당요구 종기'], basis: purpose === 'auction' ? ['auction', 'sale_mortgage', 'sale_other'] : purpose === 'credit' ? ['auction', 'dividend_end'] : ['auction'] });
    });
    valid('public_sale').forEach(function (e) { F('public_sale', 'critical', '공매공고 등기가 있습니다', { entries: [e], meaning: '체납처분으로 공매가 진행 중이라는 뜻입니다.', check: ['온비드 공매 공고'] }); });
    valid('injunction').forEach(function (e) {
      F('injunction', lv({ auction: 'high', general: 'critical', lease: 'critical', buy: 'critical', credit: 'high' }), '가처분이 유효합니다', { entries: [e], meaning: '이 부동산 자체를 두고 다툼이 있는 사람이 현재 상태를 묶어 둔 등기입니다. 처분금지가처분 뒤에 이루어진 매매·저당 등은 가처분채권자가 본안에서 승소 확정되면 그 권리 범위에서 가처분채권자에게 효력을 주장하지 못할 수 있고, 가처분채권자가 권리를 실현하는 등기를 할 때 함께 말소될 수 있습니다.', check: ['가처분 사건번호와 피보전권리', '본안 소송 진행 여부'], basis: ['injunction', 'injunction_ban', 'injunction_reg', 'p_2018da276218'] });
    });
    valid('prov_reg').forEach(function (e) {
      var isSecurity = /담보가등기/.test(NS(e.purpose));
      var maybeSecurity = !isSecurity && /대물반환/.test(NS(e.cause));
      if (e.bonDeunggi) { F('prov_reg_done', 'info', '가등기에 기한 본등기가 이뤄졌습니다(' + e.rank + '번)', { entries: [e], meaning: '본등기 순위는 가등기 때로 올라가고, 그 사이에 들어온 등기는 규칙이 정한 예외를 빼고 직권말소 대상이 됩니다.', basis: ['prov_reg_rank', 'prov_reg_delete_rule'] }); return; }
      F(isSecurity ? 'prov_reg_security' : 'prov_reg', lv({ general: 'critical', lease: 'critical', buy: 'critical', auction: isSecurity ? 'caution' : 'critical', credit: 'high' }), (isSecurity ? '담보가등기' : '가등기') + '가 유효합니다', { entries: [e], meaning: isSecurity ? '등기목적에 담보가등기로 적혀 있습니다. 경매에서는 이 권리를 가등기를 마친 날 설정된 저당권으로 보고, 매각으로 소멸합니다. 담보가등기권리자가 법원이 정한 기간 안에 채권신고를 하지 않으면 배당받을 권리를 잃는다는 대법원 판결이 있습니다.' : '장래 본등기를 받을 권리를 미리 확보해 둔 등기입니다. 본등기가 되면 순위가 가등기 때로 올라가고, 가등기 뒤에 들어온 권리는 직권 말소될 수 있습니다. 가등기 종류(소유권이전·전세권설정·저당권설정 등)에 따라 말소 범위가 다릅니다.' + (maybeSecurity ? ' 등기원인이 대물반환예약이어서 담보 목적일 가능성도 있으나, 등기 형식만으로 판별할 수는 없습니다.' : ''), check: ['가등기 원인(매매예약·대물반환예약)', '가등기권자와 소유자의 관계'], basis: isSecurity ? (purpose === 'auction' ? ['prov_security_sale', 'prov_security_rank', 'prov_security_end', 'p_2024da291102'] : ['prov_security_sale', 'prov_security_rank']) : ['prov_reg', 'prov_reg_rank', 'prov_reg_delete', 'prov_reg_scope'] });
    });
    valid('trust').forEach(function (e) {
      var trustee = e.names.filter(function (n) { return n.role === '수탁자'; }).map(function (n) { return n.name; })[0] || '';
      var tno = (NS(e.holder).match(/신탁원부제?([\d\-]+호)/) || [])[1] || '';
      F('trust', lv({ general: 'high', lease: 'critical', buy: 'critical', auction: 'high', credit: 'high' }), '신탁등기가 유효합니다' + (trustee ? ' (수탁자 ' + trustee + ')' : ''), { entries: [e], detail: tno ? '신탁원부 ' + tno : '', meaning: P({ lease: '등기부상 소유자는 수탁자(신탁회사 등)이고, 임대·처분 권한은 등기기록의 일부인 신탁원부에 적혀 있습니다. 신탁원부에 적힌 임대 조건은 임차인에게도 효력이 있어, 위탁자와 계약한 경우 보증금 반환 의무자가 신탁원부 내용에 따라 달라질 수 있다는 대법원 판결이 있습니다.', buy: '매도 권한은 신탁원부 약정에 따릅니다. 수탁자가 매도인이 되어야 하는지 확인해야 합니다.', general: '소유권이 신탁회사로 넘어간 상태입니다. 처분·임대 권한은 신탁원부에 정해져 있습니다.' }), check: ['신탁원부 발급(' + (tno || '번호 확인') + ')', '수탁자·우선수익자 동의서'], basis: purpose === 'lease' ? ['trust_reg', 'trust_notice', 'p_2019da300095'] : ['trust_reg', 'trust_notice', 'trust_exec'] });
    });
    var seiz = valid('seizure');
    seiz.forEach(function (e) {
      var holder = e.names.filter(function (n) { return n.role === '권리자'; }).map(function (n) { return n.name; })[0] || '';
      var ht = seizureHolderType(holder);
      F('seizure', lv({ auction: 'info', general: 'high', lease: 'high', buy: 'high', credit: 'high' }), '압류가 유효합니다' + (holder ? ' (' + holder + (ht ? ', ' + ht : '') + ')' : ''), { entries: [e], meaning: P({ lease: '세금·보험료 체납 등으로 행정기관이 압류한 상태입니다. 국세와 담보권·확정일자 임차권의 선후는 세금의 법정기일로 비교하므로, 압류등기일보다 앞선 세금이 보증금보다 먼저 배분될 수 있습니다.', buy: '잔금 전에 체납액을 정리하고 압류를 말소하는 조건이 필요합니다.', auction: '말소기준권리 후보입니다.', general: '체납 등으로 압류된 상태입니다.' }), check: ['국세·지방세 완납증명(임대인 동의)', '압류 해제 조건'], basis: purpose === 'lease' ? ['tax_priority', 'tax_date', 'lessor_info'] : ['tax_priority', 'tax_date'] });
    });
    if (seiz.length >= 2) F('multi_seizure', lv({ auction: 'caution', general: 'high', lease: 'critical', buy: 'high' }), '압류가 ' + seiz.length + '건 남아 있습니다', { entries: seiz, kind: '추론', meaning: '여러 기관의 체납이 겹친 상태로, 소유자의 자금 사정이 나쁠 가능성이 있습니다.' });
    var att = valid('attach');
    att.forEach(function (e) {
      var amt = pickAmount(e.amounts, ['청구금액']);
      var cred = e.names.filter(function (n) { return n.role === '채권자'; }).map(function (n) { return n.name; })[0] || '';
      var share = /지분/.test(NS(e.purpose));
      F('attach', lv({ auction: 'info', general: 'high', lease: 'high', buy: 'high', credit: 'caution' }), (share ? '지분 ' : '') + '가압류가 유효합니다' + (amt ? ' (청구금액 ' + won(amt) + ')' : ''), { entries: [e], detail: cred ? '채권자 ' + cred : '', meaning: P({ lease: '금전채권을 가진 채권자가 장래 강제집행을 보전하려고 묶어 둔 상태입니다. 강제경매로 이어지면 보증금 회수 순위 문제가 생길 수 있습니다.', buy: '잔금 전에 해제(말소) 조건이 필요합니다. 가압류가 남은 채로 이전받으면 그 부담을 안게 됩니다.', auction: '말소기준권리 후보이며 원칙적으로 매각으로 소멸 대상입니다.', general: '금전채권을 가진 채권자가 장래 강제집행을 보전하려고 부동산을 미리 묶어 둔 상태입니다.' }), check: ['가압류 사건번호(' + (e.caseNo || '확인') + ')와 본안 진행'], basis: ['attach'] });
    });
    var attEver = ever('attach'), attCancelled = attEver.filter(function (e) { return e.cancelled; });
    if (attCancelled.length >= 2 || (attCancelled.length >= 1 && att.length >= 1)) F('attach_repeat', 'caution', '가압류가 반복된 이력이 있습니다(전체 ' + attEver.length + '건, 말소 ' + attCancelled.length + '건)', { entries: attEver, kind: '추론', meaning: '채무 분쟁이 여러 차례 있었던 소유자일 수 있습니다.' });
    valid('repurchase').forEach(function (e) { F('repurchase', 'high', '환매특약이 유효합니다', { entries: [e], meaning: '환매권자가 정해진 기간 안에 환매하면 소유권이 되돌아갈 수 있습니다.', check: ['환매기간·환매대금'] }); });
    valid('warning').forEach(function (e) { F('warning', 'high', '예고등기 기록이 있습니다', { entries: [e], meaning: '등기 원인을 다투는 소송이 있었다는 표시입니다. 소송 결과를 확인해야 합니다.' }); });
    valid('rehab').forEach(function (e) { F('rehab', 'critical', '회생·파산 관련 등기가 있습니다', { entries: [e], meaning: '소유자가 회생·파산 절차에 들어가 처분이 제한되거나 관리인·관재인이 권한을 가질 수 있습니다.', check: ['사건번호와 절차 단계'] }); });
    valid('prohibit').forEach(function (e) { F('prohibit', 'high', '금지사항 부기등기가 있습니다', { entries: [e], meaning: '양도·담보 설정 등이 제한되는 부동산입니다. 금지 내용과 기간을 확인해야 합니다.' }); });

    /* 을구 권리 */
    var morts = valid('mortgage');
    var mortInfo = morts.map(function (e) {
      var amt = pickAmount(e.amounts, ['채권최고액']);
      var holder = (e.names.filter(function (n) { return /저당권자/.test(n.role) && !n.struck; }).map(function (n) { return n; })[0]) || {};
      var debtor = e.names.filter(function (n) { return n.role === '채무자' && !n.struck; }).map(function (n) { return n.name; })[0] || '';
      var subs = (e.subs || []).filter(function (s) { return !s.cancelled; });
      var increased = false, transferred = null;
      subs.forEach(function (s) {
        var a2 = pickAmount(s.amounts, ['채권최고액']);
        if (s.type === 'm_change' && a2 != null) { if (amt != null && a2 > amt) increased = { from: amt, to: a2, e: s }; amt = a2; }
        if (s.type === 'm_transfer') { var h2 = s.names.filter(function (n) { return /저당권자/.test(n.role); })[0]; if (h2) { transferred = { from: holder.name, to: h2.name, e: s, cause: s.causeText }; holder = h2; } }
      });
      var joint = (NS(e.holder).match(/공동담보목록제?([\d\-]+호)/) || [])[1] || (/공동담보/.test(NS(e.holder)) ? '있음' : '');
      return { e: e, amt: amt, holder: holder.name || '', regno: holder.regno || '', tier: lenderTier(holder.name || '', holder.regno || ''), debtor: debtor, increased: increased, transferred: transferred, joint: joint };
    });
    var mortSum = mortInfo.reduce(function (s, m) { return s + (m.amt || 0); }, 0);
    mortInfo.forEach(function (m) {
      var risky = /대부|유동화|개인/.test(m.tier);
      F('mortgage', risky ? lv({ general: 'high', lease: 'high', buy: 'high', auction: 'caution', credit: 'caution' }) : lv({ general: 'info', lease: 'caution', buy: 'caution', auction: 'info', credit: 'caution' }), '근저당권 ' + m.e.rank + '번' + (m.amt ? ' 채권최고액 ' + won(m.amt) : '') + (m.holder ? ' (' + m.holder + (m.tier ? ', ' + m.tier : '') + ')' : ''), { entries: [m.e].concat((m.e.subs || []).filter(function (s) { return !s.cancelled; })), meaning: (m.tier === '대부업체' || m.tier === '개인' || m.tier === '채권 유동화·추심 회사' ? '근저당권자가 ' + m.tier + '입니다. 은행권 대출보다 조건이 불리한 자금을 썼거나 채권이 매각됐을 수 있어 소유자 자금 사정을 의심해 볼 만합니다. ' : m.tier === '제2금융권' ? '제2금융권 담보대출입니다. ' : '') + '채권최고액은 실제 대출 잔액이 아니라 담보하는 한도입니다. 실제 잔액은 금융기관 확인이 필요합니다.' + (m.debtor && owners.length && !owners.some(function (o) { return NS(o.name) === NS(m.debtor); }) ? ' 채무자(' + m.debtor + ')가 현재 소유자와 다릅니다.' : ''), check: ['대출 잔액 확인(소유자 협조)', purpose === 'lease' ? '잔금 시 상환·말소 또는 감액 조건' : '말소 조건'].concat(m.joint ? ['공동담보목록 ' + m.joint] : []), basis: ['mortgage_max'], kind: m.tier ? '사실' : '사실' });
      if (m.increased) F('mort_increase', 'caution', m.e.rank + '번 근저당 채권최고액이 증액됐습니다', { entries: [m.increased.e], detail: won(m.increased.from) + ' → ' + won(m.increased.to), kind: '추론', meaning: '추가 대출을 받았을 가능성이 있습니다.' });
      if (m.transferred) F('mort_transfer', /확정채권양도/.test(m.transferred.cause) || /대부|유동화|개인/.test(lenderTier(m.transferred.to)) ? 'high' : 'caution', m.e.rank + '번 근저당권이 이전됐습니다', { entries: [m.transferred.e], detail: (m.transferred.from || '') + ' → ' + m.transferred.to + (m.transferred.cause ? ' (' + m.transferred.cause + ')' : ''), kind: '추론', meaning: '대출 채권이 다른 곳에 넘어갔습니다. 확정채권양도나 채권 매입회사·개인으로의 이전은 연체 채권 매각 후 경매로 이어지는 경우가 있어 진행 상황을 확인해야 합니다.', check: ['연체 여부', '경매 신청 여부'] });
      if (m.joint) F('joint', 'info', m.e.rank + '번 근저당에 공동담보가 있습니다', { entries: [m.e], meaning: '다른 부동산과 함께 담보로 잡혀 있습니다. 경매 시 채권최고액이 부동산별로 나뉘어 배당될 수 있어 공동담보목록을 확인합니다.', check: ['공동담보목록 ' + m.joint] });
    });
    if (morts.length >= 3) F('multi_mortgage', lv({ general: 'high', lease: 'high', buy: 'caution', auction: 'info' }), '유효한 근저당이 ' + morts.length + '건입니다', { entries: morts, kind: '추론', meaning: '여러 차례 담보 대출을 받은 상태로, 부채 비율이 높을 수 있습니다.' });
    var pledges = all.filter(function (e) { return e.type === 'pledge' && !e.cancelled; });
    pledges.forEach(function (e) { F('pledge', 'info', '근저당권부 질권이 있습니다', { entries: [e], meaning: '근저당권자가 자기 채권자에게 근저당권을 다시 담보로 제공한 상태입니다.' }); });
    var jeon = valid('jeonse');
    jeon.forEach(function (e) {
      var amt = pickAmount(e.amounts, ['전세금']);
      F('jeonse', lv({ general: 'caution', lease: 'high', buy: 'caution', auction: 'caution' }), '전세권이 유효합니다' + (amt ? ' (전세금 ' + won(amt) + ')' : ''), { entries: [e], meaning: P({ lease: '먼저 들어온 전세권자가 있습니다. 그 전세금이 내 보증금보다 앞섭니다.', auction: '말소기준권리보다 앞선 전세권은 매수인이 인수할 수 있습니다(배당요구 여부 확인).', general: '전세권자가 있습니다. 존속기간과 전세금을 확인합니다.' }), check: ['존속기간 만료 여부', '전세금 반환 여부'], basis: purpose === 'auction' ? ['jeonse', 'sale_take'] : ['jeonse'] });
    });
    var leasesAll = ever('lease');
    leasesAll.forEach(function (e) {
      var amt = pickAmount(e.amounts, ['임차보증금', '보증금']);
      var isOrder = /임차권등기명령/.test(NS(e.cause));
      if (!e.cancelled) F('lease_reg', lv({ general: 'critical', lease: 'critical', buy: 'high', auction: 'high', credit: 'high' }), (isOrder ? '임차권등기명령에 따른 임차권' : '임차권') + '등기가 유효합니다' + (amt ? ' (보증금 ' + won(amt) + ')' : ''), { entries: [e], meaning: (isOrder ? '등기원인이 임차권등기명령입니다. 이 제도는 임대차가 끝난 뒤 보증금을 돌려받지 못한 임차인이 신청하는 것이므로, 이 보증금이 아직 남아 있는지 확인이 필요합니다. 그 임차인이 이사해도 이미 갖춘 대항력과 우선변제권은 유지됩니다.' : '등기된 임차권이 있습니다. 등기원인이 임차권등기명령인지 임대인 협력 등기인지 원문으로 확인하십시오.') + (purpose === 'lease' ? ' 이런 임차권등기가 끝난 집을 그 이후에 빌린 임차인은 소액임차인 최우선변제를 받을 수 없습니다.' : ''), check: ['보증금 반환 여부', '임차인 퇴거 여부'], basis: isOrder ? ['lease_order', 'lease_order_effect'].concat(purpose === 'lease' ? ['lease_order_small'] : []) : ['lease_civil', 'lease_civil_effect'] });
      else F('lease_reg_past', lv({ general: 'caution', lease: 'high', buy: 'caution' }), '과거 임차권등기 이력이 있습니다(말소)', { entries: [e], kind: '추론', meaning: (isOrder ? '등기원인이 임차권등기명령이었습니다. 이전 임차인이 임대차 종료 뒤 보증금을 제때 돌려받지 못했던 이력일 수 있습니다. ' : '과거 임차권등기가 있었습니다. ') + '그때와 소유자가 같다면 보증금 반환 능력을 더 꼼꼼히 확인해야 합니다.', check: ['소유자가 그때와 같은지', '이번 계약의 보증보험 가입 가능 여부'] });
    });
    valid('superficies').forEach(function (e) {
      var holder = e.names.filter(function (n) { return n.role === '지상권자'; }).map(function (n) { return n.name; })[0] || '';
      var paired = morts.some(function (m) { return m.date === e.date || (m.no && Math.abs(m.no - e.no) <= 2 && m.date === e.date); }) || mortInfo.some(function (m) { return m.e.date === e.date && NS(m.holder) === NS(holder); });
      F('superficies', paired ? 'info' : lv({ general: 'caution', lease: 'caution', buy: 'high', auction: 'high' }), (paired ? '담보 목적으로 보이는 ' : '') + '지상권이 유효합니다' + (holder ? ' (' + holder + ')' : ''), { entries: [e], kind: paired ? '추론' : '사실', meaning: paired ? '근저당과 같은 날 같은 권리자로 설정된 지상권은 담보가치 보전을 위한 것일 수 있습니다. 근저당 말소 때 함께 말소되는지 확인합니다.' : '토지 위에 다른 사람이 건물 등을 소유할 권리가 있습니다. 토지 사용이 제한될 수 있습니다.', check: ['지상권 목적·범위·존속기간'] });
    });
    valid('easement').forEach(function (e) { F('easement', 'caution', '지역권이 유효합니다', { entries: [e], meaning: '다른 토지를 위해 이 토지를 통행 등에 쓰게 하는 권리가 있습니다.' }); });

    /* 조합 패턴 */
    if (lastX) {
      var sameDay = doc.eul.filter(function (e) { return e.type === 'mortgage' && !e.cancelled && e.date === lastX.date; });
      if (sameDay.length && lastX.type !== 'preserve') {
        var sd = sameDay.map(function (e) { return mortInfo.filter(function (m) { return m.e === e; })[0]; }).filter(Boolean);
        var total = sd.reduce(function (s, m) { return s + (m.amt || 0); }, 0);
        var price = pickAmount(lastX.amounts, ['거래가액']);
        F('sameday_mortgage', price && total && total / price >= 0.8 ? 'high' : 'caution', '소유권 이전과 같은 날 근저당이 설정됐습니다', { entries: [lastX].concat(sameDay), kind: '추론', detail: (price ? '거래가액 ' + won(price) + ', ' : '') + (total ? '같은 날 채권최고액 ' + won(total) : '') + (price && total ? ' (거래가액 대비 ' + Math.round(total / price * 100) + '%)' : ''), meaning: '매수 자금 상당 부분을 대출로 조달한 것으로 보입니다. 채권최고액이 거래가액에 가까우면 자기 자본이 거의 없는 매수일 수 있습니다.' });
      }
      var sameLease = doc.eul.filter(function (e) { return (e.type === 'jeonse' || e.type === 'lease') && e.date && Math.abs(daysBetween(lastX.date, e.date)) <= 3; });
      if (sameLease.length && lastX.type !== 'preserve') F('gap_pattern', 'high', '소유권 이전과 거의 같은 때 전세권·임차권이 설정됐습니다', { entries: [lastX].concat(sameLease), kind: '추론', meaning: '매매와 전세가 동시에 진행된 형태로, 임차인 보증금으로 매수 대금을 치렀을 수 있습니다. 매수인 자기 자본과 보증금 반환 능력을 확인해야 합니다.' });
    }
    if (preserve) {
      var tr = doc.gap.filter(function (e) { return e.type === 'trust' && e.date && daysBetween(preserve.date, e.date) >= 0 && daysBetween(preserve.date, e.date) <= 90; });
      if (tr.length) F('new_trust', 'high', '소유권보존 직후 신탁됐습니다', { entries: [preserve].concat(tr), kind: '추론', meaning: '신축 후 바로 신탁해 담보신탁 대출을 받았을 수 있습니다. 위탁자(건축주)와 임대차를 맺는 구조라면 신탁원부의 임대 권한과 우선수익자 동의를 확인해야 합니다.', check: ['신탁원부', '우선수익자(대출기관) 동의'] });
    }
    var auctions = valid('auction'), mtrans = mortInfo.filter(function (m) { return m.transferred; });
    if (auctions.length && mtrans.length) F('npl_auction', 'info', '근저당권 이전 뒤 경매가 진행되고 있습니다', { entries: mtrans.map(function (m) { return m.transferred.e; }).concat(auctions), kind: '추론', meaning: '채권을 사들인 곳이 경매를 신청했을 수 있습니다. 경매신청채권자를 사건 기록에서 확인합니다.' });

    /* 말소기준권리 */
    var baseCand = all.filter(function (e) {
      if (e.cancelled) return false;
      if (e.type === 'mortgage' || e.type === 'seizure' || e.type === 'attach' || e.type === 'auction') return true;
      if (e.type === 'prov_reg' && !e.bonDeunggi && /담보|대물반환/.test(NS(e.purpose + e.cause))) return true;
      return false;
    }).sort(function (a, b) { return dkey(a) < dkey(b) ? -1 : dkey(a) > dkey(b) ? 1 : 0; });
    var baseRight = baseCand[0] || null;
    var survive = [], extinguish = [];
    if (baseRight) {
      all.forEach(function (e) {
        if (e.cancelled || e === baseRight || !RIGHT_TYPES[e.type] || e.parent) return;
        var before = dkey(e) < dkey(baseRight);
        var item = { e: e, label: TYPE_LABEL[e.type] };
        if (!before) {
          if (e.type === 'injunction') { item.note = '후순위라도 건물철거·토지인도 청구 가처분이면 인수될 수 있어 원인 확인 필요'; survive.push(item); }
          else extinguish.push(item);
        } else {
          if (['injunction', 'prov_reg', 'superficies', 'easement', 'jeonse', 'lease', 'repurchase', 'trust', 'warning'].indexOf(e.type) >= 0) {
            item.note = e.type === 'jeonse' ? '전세권자가 배당요구하면 소멸, 아니면 인수 가능' : e.type === 'trust' ? '신탁 부동산 경매는 위탁자 채권자의 집행이 제한될 수 있어 사건 확인 필요' : '말소기준권리보다 앞서 인수 가능';
            survive.push(item);
          } else extinguish.push(item);
        }
      });
    }

    /* 금액 */
    var jeonSum = jeon.reduce(function (s, e) { return s + (pickAmount(e.amounts, ['전세금']) || 0); }, 0);
    var leaseSum = leasesAll.filter(function (e) { return !e.cancelled; }).reduce(function (s, e) { return s + (pickAmount(e.amounts, ['임차보증금', '보증금']) || 0); }, 0);
    var attSum = att.reduce(function (s, e) { return s + (pickAmount(e.amounts, ['청구금액']) || 0); }, 0);
    var money = { mortSum: mortSum, mortCount: morts.length, jeonSum: jeonSum, leaseSum: leaseSum, attSum: attSum, seizureCount: seiz.length, senior: mortSum + jeonSum + leaseSum };
    if (opt.marketPrice) {
      var mp = opt.marketPrice, dep = opt.deposit || 0;
      money.market = mp; money.deposit = dep;
      money.ratio = (money.senior + dep) / mp;
      money.ratioSenior = money.senior / mp;
      var r = money.ratio;
      if (purpose === 'lease' || dep) F('ratio', r >= 0.9 ? 'critical' : r >= 0.7 ? 'high' : 'info', '선순위 부담' + (dep ? '과 보증금' : '') + '이 시세의 ' + Math.round(r * 100) + '%입니다', { kind: '추론', detail: '등기부상 선순위 ' + won(money.senior) + (dep ? ' + 보증금 ' + won(dep) : '') + ' / 입력한 시세 ' + won(mp) + (attSum ? ' (가압류 청구금액 ' + won(attSum) + ' 별도)' : ''), meaning: '채권최고액 기준으로 계산했고 실제 대출 잔액은 더 적을 수 있습니다. 반대로 등기부에 없는 선순위 임차인 보증금과 체납 세금은 빠져 있습니다. 경매에서는 시세보다 낮게 매각되는 경우가 많습니다. 등급 구간(70%·90%)은 판독기 내부 기준이며 법령 기준이 아닙니다.', check: ['실제 대출 잔액', '전입세대 열람', '국세·지방세 체납 여부'] });
    }

    /* 카탈로그 보강 패턴 */
    if (doc.pending) F('pending', 'high', '등기신청사건 처리 중 표시가 있습니다', { meaning: '아직 반영되지 않은 등기가 있을 수 있습니다. 처리가 끝난 뒤 다시 열람해야 합니다.', basis: ['cert_pending'] });
    var mgmt = valid('mgmt');
    mgmt.forEach(function (e) { F('mgmt', lv({ general: 'high', lease: 'critical', buy: 'high', auction: 'caution', credit: 'high' }), '강제관리개시결정이 있습니다', { entries: [e], meaning: '법원이 관리인을 정해 부동산 수익(차임 등)으로 채권을 회수하는 절차입니다. 임대 관계의 상대방과 차임 지급처를 확인해야 합니다.', check: ['관리인 지정 여부', '차임 지급처'] }); });
    var aucEver = ever('auction');
    if (aucEver.length >= 2) F('auction_repeat', aucEver.some(function (e) { return !e.cancelled; }) ? 'high' : 'caution', '경매개시결정이 ' + aucEver.length + '번 있었습니다', { entries: aucEver, kind: '추론', meaning: '경매가 시작됐다가 취하·취소된 뒤 다시 시작된 이력입니다. 채무 문제가 반복된 소유자일 수 있습니다.' });
    var aucValid = valid('auction');
    if (aucValid.length) {
      var aStart = aucValid.slice().sort(byKey)[0];
      var afterAuc = all.filter(function (e) { return !e.cancelled && e !== aStart && RIGHT_TYPES[e.type] && !e.parent && dkey(e) > dkey(aStart) && e.type !== 'auction'; }).concat(doc.gap.filter(function (e) { return !e.cancelled && e.type === 'transfer' && dkey(e) > dkey(aStart); }));
      if (afterAuc.length) F('after_auction', lv({ general: 'caution', auction: 'caution', lease: 'high', buy: 'high', credit: 'caution' }), '경매개시결정 뒤에 들어온 등기가 ' + afterAuc.length + '건 있습니다', { entries: afterAuc, kind: '추론', meaning: '경매 절차 진행 중에 들어온 등기입니다. 매각되면 매수인이 인수하지 않는 부담으로 말소 촉탁 대상이 될 수 있습니다.', basis: ['sale_cancel'] });
    }
    var subro = all.filter(function (e) { return /대위자|대위원인/.test(NS(e.holder)); });
    subro.forEach(function (e) { F('subrogation', e.type === 'transfer' && /상속/.test(e.causeText) ? 'caution' : 'info', '채권자가 대신 신청한 등기(대위등기)입니다 (' + (e.sec === 'gap' ? '갑구 ' : '을구 ') + e.rank + '번)', { entries: [e], kind: e.type === 'transfer' && /상속/.test(e.causeText) ? '추론' : '사실', meaning: e.type === 'transfer' && /상속/.test(e.causeText) ? '상속인의 채권자가 상속등기를 대신 신청했습니다. 상속인 재산에 가압류·경매 등 집행을 준비한 정황일 수 있습니다.' : '등기권리자 대신 채권자가 신청한 등기입니다. 대위자와 대위원인을 원문에서 확인하십시오.' }); });
    var hug = all.filter(function (e) { return !e.cancelled && /주택도시보증공사/.test(NS(e.holder)) && (e.type === 'attach' || e.type === 'auction' || e.type === 'lease' || e.type === 'seizure'); });
    if (hug.length) F('hug', lv({ general: 'high', lease: 'critical', buy: 'high', auction: 'caution', credit: 'high' }), '주택도시보증공사가 채권자·권리자로 나옵니다', { entries: hug, kind: '추론', meaning: '보증기관이 임차인에게 보증금을 대신 내준 뒤 임대인에게 회수에 나선 정황일 수 있습니다. 임대인의 보증금 반환 능력에 문제가 있었다는 신호로 볼 수 있습니다.', check: ['같은 임대인의 다른 집 보증사고 여부'] });
    var lastXf = doc.gap.filter(function (e) { return e.type === 'transfer' && !e.cancelled && e.date; }).sort(byKey).pop();
    if (lastXf) {
      var quick = all.filter(function (e) { return !e.cancelled && (e.type === 'attach' || e.type === 'seizure') && e.date && daysBetween(lastXf.date, e.date) >= 0 && daysBetween(lastXf.date, e.date) <= 120; });
      if (quick.length) F('debt_after_transfer', 'high', '소유권 이전 뒤 4개월 안에 가압류·압류가 들어왔습니다', { entries: [lastXf].concat(quick), kind: '추론', meaning: '새 소유자에게 이미 채무 문제가 있었을 수 있습니다. 지분 대상인지, 누구의 채무인지 원문으로 확인하십시오.' });
      var swap = doc.eul.filter(function (e) { return e.type === 'cancel' && e.date; }).filter(function (c) { return doc.eul.some(function (m) { return m.type === 'mortgage' && m.date === c.date && !m.cancelled; }); });
      if (swap.length) F('refinance', 'info', '같은 날 근저당 말소와 새 근저당 설정이 있었습니다', { entries: swap, kind: '추론', meaning: '대출을 갈아탔거나(대환) 매매 잔금 때 기존 대출을 갚고 새로 빌린 것으로 보입니다.' });
    }
    valid('jeonse').forEach(function (e) {
      var m = NS(e.holder).match(/존속기간[^까]*?(\d{4}년\d{1,2}월\d{1,2}일)까지/);
      var end = m ? parseDate(m[1]) : null;
      if (end && end < base) F('jeonse_expired', lv({ general: 'caution', lease: 'high', auction: 'high', buy: 'high' }), '존속기간이 지난 전세권이 남아 있습니다 (' + e.rank + '번, ' + end + ' 만료)', { entries: [e], kind: '추론', meaning: '전세금이 반환되지 않아 말소되지 않았을 수 있습니다. 전세금 반환이 지체되면 전세권자는 경매를 청구할 수 있습니다.', check: ['전세금 반환 여부', '전세권자 경매 신청 여부'], basis: ['jeonse_auction'] });
    });
    all.filter(function (e) { return e.type === 'jeonse_mort' && !e.cancelled; }).forEach(function (e) { F('jeonse_mort', 'info', '전세권을 담보로 한 근저당이 있습니다 (' + e.rank + '번)', { entries: [e], meaning: '전세권자가 자기 전세권을 담보로 돈을 빌린 것입니다. 부동산 자체에 대한 근저당과는 다릅니다.' }); });
    valid('superficies').forEach(function (e) {
      var holder = (roleName(e, /지상권자/) || {}).name || '';
      var pairedCancelled = doc.eul.filter(function (m) { return m.type === 'mortgage' && m.cancelled && m.date === e.date && NS((roleName(m, /저당권자/) || {}).name) === NS(holder); });
      if (pairedCancelled.length && !morts.some(function (m) { return m.date === e.date; })) F('superficies_left', 'caution', '근저당은 말소됐는데 같은 날 설정된 지상권이 남아 있습니다', { entries: [e].concat(pairedCancelled), kind: '추론', meaning: '담보 목적 지상권이 정리되지 않은 것으로 보입니다. 금융기관에 말소를 요청할 수 있는지 확인하십시오.' });
    });
    if (/민간임대주택/.test(NS(doc.allText))) F('rental_housing', 'caution', '민간임대주택 부기등기 문구가 있습니다', { meaning: '등록 임대주택이라는 표시입니다. 임대사업자 등록 사항, 임대보증금 보증 가입 여부, 양도 제한 여부를 확인하십시오.', check: ['임대사업자 등록증', '임대보증금 보증 가입 확인서'] });
    if (/공장/.test(NS(doc.eul.map(function (e) { return e.purpose + e.holder; }).join('')))) F('factory', 'info', '공장저당·공장재단 관련 표시가 있습니다', { meaning: '건물과 함께 기계·기구가 담보로 묶였을 수 있습니다. 목록을 확인하십시오.' });
    if (owners.some(function (o) { return /합유/.test(o.share || ''); }) || /합유자/.test(NS(doc.gap.map(function (e) { return e.holder; }).join('')))) F('joint_own', 'caution', '합유 표시가 있습니다', { meaning: '조합 등 여러 사람이 함께 소유하는 형태입니다. 처분·임대에 합유자 전원의 참여가 필요한지 확인하십시오.' });
    if (owners.some(function (o) { return /^(대한민국|국|[가-힣]+(특별시|광역시|특별자치시|도|시|군|구))$/.test(NS(o.name)) || /공사$|공단$/.test(NS(o.name)); })) F('public_owner', 'info', '소유자가 국가·지자체·공공기관입니다', { meaning: '임대·매각 절차가 일반 거래와 다를 수 있습니다.' });
    doc.gap.filter(function (e) { return e.type === 'transfer' && /명의신탁해지|진정명의회복/.test(e.causeText); }).forEach(function (e) { F('nominee', 'caution', '명의신탁 해지·진정명의회복으로 이전된 이력이 있습니다(' + e.rank + '번)', { entries: [e], meaning: '등기 명의와 실제 소유가 달랐던 이력입니다. 현재 명의의 근거를 확인하십시오.' }); });
    var protoProh = valid('prohibit');
    if (protoProh.length) { var afterP = all.filter(function (e) { return !e.cancelled && (e.type === 'transfer' || e.type === 'mortgage') && dkey(e) > dkey(protoProh[0]); }); if (afterP.length) F('after_prohibit', 'high', '금지사항 부기등기 뒤에 이전·담보 설정이 있습니다', { entries: protoProh.concat(afterP), kind: '추론', meaning: '처분 제한이 있는 상태에서 이루어진 등기입니다. 효력과 제한 기간을 확인하십시오.' }); }
    valid('prov_reg').forEach(function (e) {
      if (e.bonDeunggi || !e.date) return;
      var yrs = Math.floor(daysBetween(e.date, base) / 365);
      var laterCnt = all.filter(function (x) { return !x.cancelled && dkey(x) > dkey(e) && RIGHT_TYPES[x.type]; }).length;
      if (yrs >= 3) F('prov_old', 'caution', e.rank + '번 가등기가 ' + yrs + '년째 본등기 없이 남아 있습니다', { entries: [e], kind: '추론', detail: '가등기 뒤 유효한 권리 ' + laterCnt + '건', meaning: '오래된 가등기라도 본등기가 되면 뒤의 권리가 말소될 수 있어 가등기권자에게 말소 의사를 확인해야 합니다.', basis: ['prov_reg_delete'] });
      if (/담보가등기/.test(NS(e.purpose)) && !morts.length) F('prov_only', 'caution', '근저당 없이 담보가등기만 있습니다', { entries: [e], kind: '추론', meaning: '금융기관 대출이 아닌 사인 간 차용의 담보일 수 있습니다. 가등기권자와 채무 내용을 확인하십시오.' });
    });
    if (doc.summary && !doc.summary.ownersOnly) {
      var mism = all.filter(function (e) { return e.summaryNote; });
      if (mism.length) F('summary_mismatch', 'info', '본문과 주요 등기사항 요약이 다른 항목이 ' + mism.length + '건 있습니다', { entries: mism, meaning: mism.map(function (e) { return (e.sec === 'gap' ? '갑' : '을') + e.rank + ': ' + e.summaryNote; }).join(' / ') + '. 판독 결과를 원문으로 확인하십시오.' });
    }
    if (doc.kind === '집합건물' && !daeji.length && preserve && daysBetween(preserve.date, base) > 730) F('no_daeji_long', 'caution', '보존등기 후 2년이 넘도록 대지권 표시가 없습니다', { entries: [preserve], kind: '추론', meaning: '대지권 등기가 오래 지연된 경우 토지 분쟁이나 분양대금 미정산 사정이 있을 수 있습니다.' });
    var leaseHolders = leasesAll.map(function (e) { return NS((roleName(e, /임차권자/) || {}).name); }).filter(Boolean);
    valid('auction').forEach(function (a) { if (/강제/.test(a.purpose) && leaseHolders.some(function (n) { return NS(a.holder).indexOf(n) >= 0; })) F('tenant_auction', 'high', '임차인이 직접 강제경매를 신청한 것으로 보입니다', { entries: [a], kind: '추론', meaning: '보증금을 돌려받지 못한 임차인이 판결 등을 받아 경매를 신청한 정황입니다.' }); });
    var aucAcq = doc.gap.filter(function (e) { return e.type === 'transfer' && /매각|공매/.test(e.causeText) && e.date; });
    aucAcq.forEach(function (e) { var nx = doc.gap.filter(function (x) { return x.type === 'transfer' && x.date && dkey(x) > dkey(e); })[0]; if (nx && daysBetween(e.date, nx.date) <= 365) F('auction_flip', 'info', '경매·공매로 산 뒤 1년 안에 다시 팔렸습니다', { entries: [e, nx], kind: '추론', meaning: '낙찰 후 단기 매도입니다. 매각 당시 정리된 권리와 현재 가격을 비교해 보십시오.' }); });

    /* 사해행위 신호 */
    var fraud = detectFraud(doc, base, purpose);
    fraud.forEach(function (c) {
      if (c.score < 30) return;
      F('fraud', c.direct ? 'critical' : c.score >= 60 ? lv({ general: 'high', buy: 'critical', lease: 'high', credit: 'high', auction: 'caution' }) : 'caution',
        (c.direct ? '사해행위취소를 원인으로 한 가처분이 있습니다' : '사해행위로 다툴 여지가 있는 처분 신호: ' + c.kind) + ' (' + (c.act.sec === 'gap' ? '갑구 ' : '을구 ') + c.act.rank + '번)',
        { entries: [c.act].concat(c.related), kind: c.direct ? '사실' : '추론', detail: '신호: ' + c.signals.join(', ') + (c.counter.length ? ' / 반대 사정: ' + c.counter.join(', ') : ''),
          meaning: c.meaning, check: c.check, basis: c.basis });
    });

    /* 등기부 밖 확인 */
    var outside = {
      lease: ['전입세대 열람(선순위 임차인)', '확정일자 부여 현황(임대인 동의 또는 계약 후 임차인 열람)', '국세·지방세 납세증명(체납 여부)', '건축물대장(용도·위반건축물)', '임대인 신분 확인과 대리 계약 시 위임장·인감증명서', '전세보증금 반환보증 가입 가능 여부'],
      buy: ['건축물대장', '토지이용계획확인서', '매도인 신분과 공유자 동의', '잔금일 재열람', '관리비·공과금 정산'],
      auction: ['매각물건명세서', '현황조사서', '감정평가서', '전입세대 열람', '법원 문건·송달내역'],
      credit: ['선순위 채권 실제 잔액', '전입세대 열람', '체납 세금 여부', '공동담보 부동산'],
      general: ['건축물대장', '전입세대 열람', '토지 등기부(집합건물이면 별도등기 여부)']
    };
    if (doc.gap.some(function (e) { return e.type === 'trust' && !e.cancelled; })) outside[purpose] = ['신탁원부'].concat(outside[purpose] || outside.general);

    flags.sort(function (a, b) { return LV[b.level] - LV[a.level]; });
    var counts = { critical: 0, high: 0, caution: 0, info: 0 };
    flags.forEach(function (f) { counts[f.level]++; });
    var grade = counts.critical ? 'critical' : counts.high ? 'high' : counts.caution ? 'caution' : 'info';
    var GRADE_LABEL = { critical: '위험 신호 있음', high: '주의 필요', caution: '확인 필요', info: '등기부상 특이사항 적음' };

    var timeline = all.slice().sort(function (a, b) { return dkey(a) < dkey(b) ? -1 : dkey(a) > dkey(b) ? 1 : a.sec < b.sec ? -1 : 1; });

    // 현재 유효한 갑구·을구 권리 개수
    var currentRights = all.filter(function (e) { return !e.cancelled && RIGHT_TYPES[e.type] && !e.parent; });

    var earliestSec = all.filter(function (e) { return !e.cancelled && (e.type === 'mortgage' || (e.type === 'prov_reg' && /담보가등기/.test(NS(e.purpose)))) && e.date; }).map(function (e) { return e.date; }).sort()[0] || '';
    var rep = {
      purpose: purpose, purposeLabel: PURPOSES[purpose], base: base, flags: flags, counts: counts, grade: grade, gradeLabel: GRADE_LABEL[grade],
      owners: owners, ownersSrc: own.src, ownersApprox: own.approx, use: use, area: area, daejiRatio: daejiRatio, daejiType: daejiType,
      money: money, baseRight: baseRight, survive: survive, extinguish: extinguish, timeline: timeline, mortInfo: mortInfo,
      outside: outside[purpose] || outside.general, currentRights: currentRights, fraud: fraud,
      smallTenant: { earliest: earliestSec, table: smallTenantFor(earliestSec), seoul: /^서울특별시/.test(NS(doc.address)), before2014: !!earliestSec && earliestSec < '2014-01-01' },
      stats: { gap: doc.gap.length, eul: doc.eul.length, cancelled: all.filter(function (e) { return e.cancelled; }).length, strikes: all.filter(function (e) { return e.visualStruck; }).length, summary: !!doc.summary }
    };
    rep.story = buildStory(doc, rep);
    rep.auction = auctionAnalysis(doc, rep);
    rep.scenarios = buildScenarios(doc, rep, { att: att, seiz: seiz, morts: morts, jeon: jeon, leasesAll: leasesAll, xfers: xfers, lastX: lastX, preserve: preserve, opt: opt });
    return rep;
  }

  /* ------------------------------------------------------------------ */
  /* 6-1. 보조: 사람·이름                                                  */
  /* ------------------------------------------------------------------ */
  function isPerson(name, regno) { var n = NS(name); return !!n && !isCorp(name, regno) && /^[가-힣]{2,5}$/.test(n); }
  function sameSurname(a, b) { var x = NS(a), y = NS(b); return isPerson(x) && isPerson(y) && x !== y && x.charAt(0) === y.charAt(0); }
  function roleName(e, re) { var n = e.names.filter(function (x) { return re.test(x.role) && !x.struck; })[0] || e.names.filter(function (x) { return re.test(x.role); })[0]; return n || null; }
  function ownersOf(e) { return e.names.filter(function (n) { return /소유자|공유자|수탁자/.test(n.role) && !n.struck; }); }
  function byKey(a, b) { return dkey(a) < dkey(b) ? -1 : dkey(a) > dkey(b) ? 1 : 0; }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function josa(word, withJong, noJong) {
    var w = String(word || '').replace(/[\s)\]]+$/, ''); if (!w) return noJong;
    var ch = w.charCodeAt(w.length - 1);
    if (ch < 0xAC00 || ch > 0xD7A3) return /[013678]$/.test(w) ? withJong : noJong;
    var jong = (ch - 0xAC00) % 28;
    if (withJong === '으로') return jong && jong !== 8 ? '으로' : '로';
    return jong ? withJong : noJong;
  }
  function kdate(d) { if (!d) return '날짜 미상'; var p = d.split('-'); return p[0] + '년 ' + (+p[1]) + '월 ' + (+p[2]) + '일'; }

  /* ------------------------------------------------------------------ */
  /* 6-2. 사해행위 신호                                                    */
  /* ------------------------------------------------------------------ */
  var FRAUD_MEANING = {
    general: '채무가 많은 소유자가 재산을 처분해 채권자가 돈을 받기 어려워지면, 채권자는 그 처분을 취소하고 원상회복을 법원에 청구할 수 있습니다(채권자취소권). 등기부만으로는 채무초과 여부와 당사자가 그 사정을 알았는지를 알 수 없어 신호만 보여 드립니다.',
    buy: '매도인의 취득이나 이번 매매가 취소 소송의 대상이 되면 소유권을 되돌려야 하는 분쟁에 휘말릴 수 있습니다. 처분 경위와 매도인 쪽 채무를 확인해야 합니다.',
    lease: '소유권을 두고 취소 소송이 벌어지면 계약 상대방의 지위가 불안정해질 수 있습니다. 소송 진행 여부를 확인해야 합니다.',
    credit: '채권자 입장에서는 이 처분을 채권자취소 소송으로 되돌릴 수 있는지 검토할 수 있습니다. 취소원인을 안 날부터 1년, 법률행위가 있은 날부터 5년 안에 청구해야 합니다.',
    auction: '과거 처분이 취소 소송 중이면 소유 관계와 매각 절차에 영향을 줄 수 있어 사건 기록을 확인해야 합니다.'
  };
  function detectFraud(doc, base, purpose) {
    var gap = doc.gap, eul = doc.eul, all = gap.concat(eul), out = [];
    var debt = all.filter(function (e) { return (e.type === 'attach' || e.type === 'seizure' || e.type === 'auction') && e.date; });
    var owns = gap.filter(function (e) { return (e.type === 'preserve' || e.type === 'transfer' || (e.type === 'trust' && /소유권이전/.test(NS(e.purpose)))) && e.date; }).sort(byKey);
    var fraudInj = all.filter(function (e) { return e.type === 'injunction' && /사해/.test(NS(e.holder + e.cause + e.purpose)); });
    function liveAt(d, date) { return d.date <= date && (!d.cancelled || !d.cancelDate || d.cancelDate > date); }
    function ownerAt(date) { var o = null; owns.forEach(function (x) { if (x.date <= date) o = x; }); return o ? ownersOf(o) : []; }
    var taxDebt = debt.some(function (d) { return d.type === 'seizure'; });
    var basisFor = function (kind, direct) {
      var b = ['fraud_406', 'fraud_407'];
      if (/매매/.test(kind)) b.push('p_fraud_sole');
      if (/대물변제/.test(kind)) b.push('p_fraud_substitute');
      if (/신탁/.test(kind)) b.push('fraud_trust');
      if (/근저당/.test(kind)) b.push('p_fraud_mortgage');
      if (/협의분할/.test(kind)) b.push('p_fraud_division', 'p_fraud_renounce');
      b.push('p_fraud_bad_faith');
      if (direct) b.push('p_fraud_restore');
      if (taxDebt) b.push('fraud_tax');
      return b;
    };
    var checkFor = function (direct) {
      var c = ['처분한 사람의 다른 재산과 채무 규모(채무초과 여부)', '받은 사람과의 관계와 실제 대가 지급 여부', '채권이 처분보다 먼저 생겼는지'];
      if (direct) c.unshift('가처분 사건번호로 본안(사해행위취소 소송) 진행 확인');
      return c;
    };
    function debtorName(d) { var m = NS(d.purpose).match(/\d+번([가-힣]{2,5})지분/); return m ? m[1] : ''; }
    function appliesTo(d, names) { var n = debtorName(d); return !n || !names.length || names.some(function (x) { return NS(x) === n; }); }
    function lastXferBefore(date) { var r = null; owns.forEach(function (x) { if (x.type !== 'preserve' && x.date <= date) r = x; }); return r; }
    owns.forEach(function (x, i) {
      if (x.type === 'preserve') return;
      var prevO = owns.slice(0, i).filter(function (o) { return !o.cancelled; }).pop();
      var from = prevO ? ownersOf(prevO) : [], to = ownersOf(x);
      var shareOf = (NS(x.purpose).match(/\d+번([가-힣]{2,5})지분/) || [])[1];
      if (shareOf) from = from.filter(function (f) { return NS(f.name) === shareOf; }).concat(from.length && !from.some(function (f) { return NS(f.name) === shareOf; }) ? [{ name: shareOf, regno: '' }] : []);
      var fromNames = from.map(function (f) { return f.name; });
      var c = x.causeText, sig = [], counter = [], score = 0, kind;
      if (/증여/.test(c)) { sig.push('증여(무상 이전)'); score += 25; kind = '증여'; }
      else if (/협의분할/.test(c)) { sig.push('상속재산 협의분할'); score += 10; kind = '상속재산 협의분할'; }
      else if (/대물변제/.test(c)) { sig.push('대물변제'); score += 20; kind = '대물변제'; }
      else if (/매매/.test(c)) kind = '매매';
      else if (x.type === 'trust') kind = '신탁';
      else kind = c || '소유권 이전';
      var price = pickAmount(x.amounts, ['거래가액']), prevPrice = null;
      owns.slice(0, i).forEach(function (o) { var p = pickAmount(o.amounts, ['거래가액']); if (p) prevPrice = p; });
      var maxMort = 0; eul.forEach(function (m) { if (m.type === 'mortgage' && m.date && m.date <= x.date) { var a = pickAmount(m.amounts, ['채권최고액']); if (a > maxMort) maxMort = a; } });
      if (price && prevPrice && price < prevPrice * 0.5) { sig.push('거래가액 ' + won(price) + '이 직전 거래가 ' + won(prevPrice) + '의 절반 미만'); score += 20; }
      else if (price && maxMort && price < maxMort * 0.3) { sig.push('거래가액 ' + won(price) + '이 앞서 설정된 근저당 한도 ' + won(maxMort) + '보다 크게 낮음'); score += 20; }
      if (from.some(function (f) { return to.some(function (t) { return sameSurname(f.name, t.name); }); })) { sig.push('주고받은 사람의 성씨가 같음(가족일 수 있음, 추정)'); score += 10; }
      var before = debt.filter(function (d) { return liveAt(d, x.date) && daysBetween(d.date, x.date) <= 730 && appliesTo(d, fromNames); });
      if (before.length) { sig.push('처분 당시 남아 있던 ' + uniq(before.map(function (d) { return TYPE_LABEL[d.type]; })).join('·') + ' ' + before.length + '건'); score += 30; }
      var inj = fraudInj.filter(function (f) { return f.date && f.date >= x.date && lastXferBefore(f.date) === x; });
      var direct = inj.length > 0;
      if (direct) { sig.push('처분 뒤 사해행위취소를 원인으로 한 가처분'); score += 60; }
      var mBefore = eul.filter(function (m) { var h = roleName(m, /저당권자/); return m.type === 'mortgage' && m.date && daysBetween(m.date, x.date) >= 0 && daysBetween(m.date, x.date) <= 180 && h && isPerson(h.name, h.regno); });
      if (mBefore.length) { sig.push('처분 전 6개월 안에 개인 명의 근저당'); score += 15; }
      var mToSame = eul.filter(function (m) { var h = roleName(m, /저당권자/); return m.type === 'mortgage' && m.date && m.date <= x.date && h && to.some(function (t) { return NS(t.name) === NS(h.name); }); });
      if (mToSame.length) { sig.push('받은 사람이 앞서 근저당권자였음'); score += 20; mBefore = mBefore.concat(mToSame.filter(function (m) { return mBefore.indexOf(m) < 0; })); }
      if (!before.length && !direct) counter.push('처분 당시 등기부상 가압류·압류·경매 기록 없음');
      if (kind === '매매' && price && prevPrice && price >= prevPrice * 0.8) counter.push('거래가액이 직전 거래가와 비슷함');
      if (daysBetween(x.date, base) > 365 * 5) counter.push('처분일부터 5년이 지남');
      if (!sig.length) return;
      out.push({ act: x, kind: kind, score: Math.min(100, score), direct: direct, signals: sig, counter: counter, related: before.concat(inj).concat(mBefore), from: from.map(function (f) { return f.name; }), to: to.map(function (t) { return t.name; }), meaning: FRAUD_MEANING[purpose] || FRAUD_MEANING.general, check: checkFor(direct), basis: basisFor(kind, direct) });
    });
    all.forEach(function (m) {
      var isM = m.type === 'mortgage', isP = m.type === 'prov_reg' && !m.bonDeunggi, isJ = m.type === 'jeonse';
      if (!(isM || isP || isJ) || !m.date) return;
      var h = roleName(m, isM ? /저당권자/ : isP ? /가등기권자|권리자/ : /전세권자|임차권자/);
      if (!h || !isPerson(h.name, h.regno)) return;
      var own = ownerAt(m.date), sig = ['개인 명의 ' + (isM ? '근저당' : isP ? '가등기' : TYPE_LABEL[m.type])], score = 10, counter = [];
      var fam = own.some(function (o) { return sameSurname(o.name, h.name); });
      if (isJ && !fam) return;
      if (fam) { sig.push('소유자와 성씨가 같음(가족일 수 있음, 추정)'); score += 15; }
      var before = debt.filter(function (d) { return liveAt(d, m.date) && daysBetween(d.date, m.date) <= 730; });
      var soon = debt.filter(function (d) { return d.date > m.date && daysBetween(m.date, d.date) <= 180; });
      if (before.length) { sig.push('설정 당시 남아 있던 가압류·압류·경매 ' + before.length + '건'); score += 30; }
      if (soon.length) { sig.push('설정 뒤 6개월 안에 가압류·압류·경매 ' + soon.length + '건'); score += 15; }
      var nextX = owns.filter(function (x) { return x.date > m.date && daysBetween(m.date, x.date) <= 180 && x.type !== 'preserve'; })[0];
      if (nextX) { sig.push('설정 뒤 6개월 안에 소유권 이전'); score += 10; if (ownersOf(nextX).some(function (t) { return NS(t.name) === NS(h.name); })) { sig.push('근저당권자가 그 뒤 소유자가 됨'); score += 20; } }
      if (isP) score += 10;
      if (score < 25) return;
      var kind = isM ? '개인에게 근저당 설정' : isP ? '개인 명의 가등기' : TYPE_LABEL[m.type] + ' 설정';
      out.push({ act: m, kind: kind, score: Math.min(100, score), direct: false, signals: sig, counter: counter, related: before.concat(soon), from: own.map(function (o) { return o.name; }), to: [h.name], meaning: FRAUD_MEANING[purpose] || FRAUD_MEANING.general, check: checkFor(false), basis: basisFor(kind, false) });
    });
    fraudInj.forEach(function (f) {
      if (out.some(function (o) { return o.related.indexOf(f) >= 0; })) return;
      out.push({ act: f, kind: '사해행위취소 가처분', score: 90, direct: true, signals: ['가처분 기재에 사해행위취소가 원인으로 적힘'], counter: [], related: [], from: [], to: [], meaning: FRAUD_MEANING[purpose] || FRAUD_MEANING.general, check: checkFor(true), basis: basisFor('', true) });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 6-3. 쉬운 시간순 설명                                                 */
  /* ------------------------------------------------------------------ */
  function narrate(e, ctx) {
    var who = function (re) { var n = roleName(e, re); return n ? n.name : ''; };
    var amt = function (labels) { return pickAmount(e.amounts, labels); };
    var tgt = e.main || (e.targets && e.targets[0]) || '';
    var thing = ctx.kind === '토지' ? '토지' : ctx.kind === '집합건물' ? '이 집' : '건물';
    var c = e.causeText || '';
    switch (e.type) {
      case 'preserve': { var o = ownersOf(e).map(function (x) { return x.name; }).join(', ') || '소유자'; return o + josa(o, '이', '가') + ' ' + thing + '을 처음 자기 이름으로 등기했습니다(소유권보존). 새로 지었거나 처음 등기된 부동산입니다.'; }
      case 'transfer': case 'trust': {
        var to = ownersOf(e).map(function (x) { return x.name; }).join(', ') || '새 소유자', from = ctx.prevOwner || '';
        var part = /일부이전|지분/.test(NS(e.purpose)) ? '지분 일부가 ' : '';
        if (e.type === 'trust') { var tr = who(/수탁자/) || to; return (from ? from + josa(from, '이', '가') + ' ' : '') + tr + '에 신탁했습니다. 이때부터 등기부상 소유자는 ' + tr + '입니다.'; }
        if (/매매/.test(c)) { var p = amt(['거래가액']); return to + josa(to, '이', '가') + ' ' + (part ? '지분 일부를 ' : '') + (p ? won(p) + '에 ' : '') + '샀습니다(매매).'; }
        if (/증여/.test(c)) return (from ? from + josa(from, '이', '가') + ' ' : '') + to + '에게 ' + (part || '') + '증여했습니다(무상으로 넘김).';
        if (/상속/.test(c)) return (from ? from + '의 ' : '') + '상속으로 ' + to + '에게 ' + (part || '') + '넘어갔습니다' + (/협의분할/.test(c) ? '(상속인들이 나누기로 협의)' : '') + '.';
        if (/경매로인한매각|매각$/.test(c)) return '경매에서 ' + to + josa(to, '이', '가') + ' 낙찰받아 소유자가 됐습니다.';
        if (/공매/.test(c)) return '공매로 ' + to + josa(to, '이', '가') + ' 소유자가 됐습니다.';
        if (/판결|화해|조정/.test(c)) return '법원의 판결·화해 등에 따라 ' + to + '에게 소유권이 넘어갔습니다.';
        if (/유증|사인증여/.test(c)) return (from ? from + '의 ' : '') + '유언(유증)으로 ' + to + '에게 넘어갔습니다.';
        if (/재산분할/.test(c)) return '이혼 등에 따른 재산분할로 ' + to + '에게 넘어갔습니다.';
        if (/공유물분할/.test(c)) return '공유자들이 나누기로 해(공유물분할) ' + to + '에게 넘어갔습니다.';
        if (/명의신탁해지/.test(c)) return '다른 사람 이름으로 해 두었던 명의를 정리해(명의신탁 해지) ' + to + '에게 넘어갔습니다.';
        if (/진정명의회복/.test(c)) return '원래 주인의 명의를 되찾는 방식(진정명의회복)으로 ' + to + '에게 넘어갔습니다.';
        if (/수용/.test(c)) return '공공사업 수용으로 ' + to + '에게 넘어갔습니다.';
        if (/대물변제/.test(c)) return '빚 대신 부동산으로 갚는 방식(대물변제)으로 ' + to + '에게 넘어갔습니다.';
        if (/신탁재산귀속|신탁종료|신탁해지/.test(c)) return '신탁이 끝나 ' + to + '에게 소유권이 돌아왔습니다.';
        return (c ? c + josa(c, '으로', '로') + ' ' : '') + to + '에게 ' + (part || '') + '소유권이 넘어갔습니다.';
      }
      case 'mortgage': {
        var h = who(/저당권자/), d = who(/채무자/), a = amt(['채권최고액']);
        var owner = ctx.owner || '';
        var base = (d || owner || '소유자') + josa(d || owner || '소유자', '이', '가') + ' ' + (h ? h + '에서 ' : '') + '이 부동산을 담보로 돈을 빌렸습니다(근저당' + (a ? ', 한도 ' + won(a) : '') + ').';
        if (d && owner && NS(d) !== NS(owner) && owner.indexOf(',') < 0) base += ' 빚진 사람은 ' + d + '이고, ' + owner + josa(owner, '은', '는') + ' 담보만 제공했습니다.';
        return base;
      }
      case 'm_change': { var a2 = amt(['채권최고액']); return tgt + '번 근저당의 ' + (a2 ? '한도가 ' + won(a2) + josa(won(a2), '으로', '로') + ' 바뀌었습니다.' : '내용이 바뀌었습니다.'); }
      case 'm_transfer': { var nh = who(/저당권자/); return tgt + '번 근저당(대출 채권)이 ' + (nh ? nh + '에게 ' : '다른 곳으로 ') + '넘어갔습니다' + (c ? '(' + c + ')' : '') + '.'; }
      case 'pledge': return tgt + '번 근저당에 질권이 붙었습니다. 근저당권자가 그 권리를 다시 담보로 맡긴 것입니다.';
      case 'attach': { var cr = who(/채권자/), a3 = amt(['청구금액']); return (cr || '채권자') + josa(cr || '채권자', '이', '가') + ' 받을 돈' + (a3 ? ' ' + won(a3) : '') + '을 지키려고 ' + (/지분/.test(NS(e.purpose)) ? '지분을 ' : '') + '가압류했습니다.'; }
      case 'seizure': { var hz = who(/권리자/); return (hz || '행정기관') + josa(hz || '행정기관', '이', '가') + ' 세금·보험료 등을 받으려고 압류했습니다.'; }
      case 'auction': { var court = (e.cause.replace(/\s/g, '').match(/([가-힣]+지방법원(?:[가-힣]+지원)?)/) || [])[1] || '법원'; return court + josa(court, '이', '가') + ' ' + (/임의/.test(e.purpose) ? '근저당 등 담보권에 따른 ' : /강제/.test(e.purpose) ? '판결 등에 따른 ' : '') + '경매를 시작했습니다' + (e.caseNo ? '(' + e.caseNo + ')' : '') + '.'; }
      case 'public_sale': return '세금 체납으로 공매가 공고됐습니다.';
      case 'mgmt': return '법원이 관리인을 두어 임대 수익 등으로 빚을 갚게 하는 강제관리를 시작했습니다.';
      case 'jeonse_mort': return tgt + '번 전세권을 담보로 전세권자가 돈을 빌렸습니다(전세권부 근저당).';
      case 'injunction': { var ci = who(/채권자/); return (ci || '누군가') + josa(ci || '누군가', '이', '가') + ' 이 부동산을 다른 사람에게 넘기거나 담보로 잡히지 못하게 가처분했습니다.' + (/사해/.test(NS(e.holder + e.cause)) ? ' 사해행위취소(빼돌린 재산 되돌리기)를 이유로 한 것입니다.' : ''); }
      case 'prov_reg': { if (e.bonDeunggi) return '가등기에 따라 소유권이 넘어갔습니다(본등기).'; var hp = who(/가등기권자|권리자/); return (hp || '누군가') + josa(hp || '누군가', '이', '가') + ' 나중에 소유권 등을 넘겨받을 권리를 가등기로 확보했습니다' + (/담보가등기/.test(NS(e.purpose)) ? '(돈을 빌려준 담보 목적)' : '') + '.'; }
      case 'jeonse': { var hj = who(/전세권자/), a4 = amt(['전세금']); return (hj || '전세권자') + josa(hj || '전세권자', '이', '가') + ' 전세권을 등기했습니다' + (a4 ? '(전세금 ' + won(a4) + ')' : '') + '.'; }
      case 'lease': { var hl = who(/임차권자/), a5 = amt(['임차보증금', '보증금']); return /임차권등기명령/.test(NS(e.cause)) ? '임차인' + (hl ? ' ' + hl : '') + josa(hl || '임차인', '이', '가') + ' 보증금' + (a5 ? ' ' + won(a5) : '') + '을 돌려받지 못해 법원 명령으로 임차권등기를 했습니다.' : '임차권이 등기됐습니다' + (a5 ? '(보증금 ' + won(a5) + ')' : '') + '.'; }
      case 'superficies': { var hs = who(/지상권자/); return (hs ? hs + '에게 ' : '') + '지상권(땅 위에 건물 등을 소유할 권리)이 설정됐습니다.'; }
      case 'easement': return '지역권(다른 땅을 위해 이 땅을 쓰는 권리)이 설정됐습니다.';
      case 'repurchase': return '환매특약(정한 기간 안에 되살 수 있는 약정)이 등기됐습니다.';
      case 'warning': return '등기 원인을 다투는 소송이 있다는 예고등기가 됐습니다.';
      case 'rehab': return '회생·파산 절차와 관련된 등기가 됐습니다.';
      case 'prohibit': return '양도·담보 설정을 제한하는 금지사항이 등기됐습니다.';
      case 'cancel': {
        var labs = (e.targets || []).map(function (t) { var x = ctx.byRank[t]; return t + '번 ' + (x ? TYPE_LABEL[x.type] : '등기'); });
        var why = /해지/.test(c) ? '해지' : /해제/.test(c) ? '해제' : /취하/.test(c) ? '취하' : /취소/.test(c) ? '취소' : /변제/.test(c) ? '변제' : /매각/.test(c) ? '경매 매각' : /포기/.test(c) ? '포기' : c;
        return (labs.join(', ') || '이전 등기') + josa(labs.join(', ') || '등기', '이', '가') + ' 지워졌습니다' + (why ? '(' + why + ')' : '') + '.';
      }
      case 'restore': return '말소됐던 등기가 되살아났습니다(말소회복).';
      case 'name_change': return tgt + '번 등기 명의인의 주소 등 표시가 바뀌었습니다.';
      case 'correction': return '기존 등기 내용을 바로잡았습니다(경정).';
      default: return oneLine(e.purpose) + ' 등기가 됐습니다.';
    }
  }
  function buildStory(doc, rep) {
    var all = doc.gap.concat(doc.eul).slice().sort(function (a, b) { return byKey(a, b) || (a.sec < b.sec ? -1 : 1); });
    var byRankG = {}, byRankE = {};
    doc.gap.forEach(function (e) { byRankG[e.rank] = e; }); doc.eul.forEach(function (e) { byRankE[e.rank] = e; });
    var owner = '', prevOwner = '', out = [];
    all.forEach(function (e) {
      var ctx = { kind: doc.kind, owner: owner, prevOwner: owner, byRank: e.sec === 'gap' ? byRankG : byRankE };
      var text = narrate(e, ctx);
      if ((e.type === 'preserve' || e.type === 'transfer' || (e.type === 'trust' && /소유권이전/.test(NS(e.purpose))) || (e.type === 'prov_reg' && e.bonDeunggi)) && !e.cancelled) {
        var os = ownersOf(e).map(function (x) { return x.name; });
        if (os.length) { prevOwner = owner; owner = /일부이전|지분/.test(NS(e.purpose)) && owner ? owner + ', ' + os.join(', ') : os.join(', '); }
      }
      var lvl = { auction: 'critical', injunction: 'critical', prov_reg: 'high', lease: 'high', attach: 'high', seizure: 'high', trust: 'high', public_sale: 'critical', rehab: 'critical' }[e.type] || (e.type === 'cancel' ? 'done' : 'info');
      out.push({ date: e.date, year: e.date ? e.date.slice(0, 4) : '', sec: e.sec, rank: e.rank, text: text, cancelled: !!e.cancelled && e.type !== 'cancel', cancelNote: e.cancelled && e.type !== 'cancel' ? (e.cancelledBy ? '나중에 ' + e.cancelledBy + '번으로 말소' : '나중에 말소') : '', level: e.cancelled && e.type !== 'cancel' ? 'done' : lvl, minor: e.type === 'name_change' || e.type === 'correction', e: e });
    });
    var now = [];
    if (rep.owners.length) now.push('현재 등기부상 소유자는 ' + rep.owners.map(function (o) { return o.name + (o.share && o.share !== '단독소유' ? '(' + o.share + ')' : ''); }).join(', ') + '입니다.');
    var live = rep.currentRights.map(function (e) { return TYPE_LABEL[e.type]; });
    if (live.length) {
      var cnt = {}; live.forEach(function (l) { cnt[l] = (cnt[l] || 0) + 1; });
      now.push('지금 남아 있는 권리는 ' + Object.keys(cnt).map(function (k) { return k + ' ' + cnt[k] + '건'; }).join(', ') + '입니다.');
    } else now.push('지금 남아 있는 가압류·근저당 같은 권리는 등기부상 보이지 않습니다.');
    if (rep.money.mortSum) now.push('근저당 한도(채권최고액) 합계는 ' + won(rep.money.mortSum) + '입니다. 실제 남은 빚은 이보다 적을 수 있습니다.');
    return { events: out, now: now };
  }

  /* ------------------------------------------------------------------ */
  /* 6-4. 경매 권리분석                                                    */
  /* ------------------------------------------------------------------ */
  function auctionAnalysis(doc, rep) {
    var all = doc.gap.concat(doc.eul), base = rep.baseRight, rows = [], takeover = 0, notes = [];
    function amtOf(e) { return pickAmount(e.amounts, e.type === 'jeonse' ? ['전세금'] : e.type === 'lease' ? ['임차보증금', '보증금'] : e.type === 'mortgage' ? ['채권최고액'] : ['청구금액']); }
    all.filter(function (e) { return !e.cancelled && RIGHT_TYPES[e.type] && !e.parent && e.type !== 'pledge'; }).sort(byKey).forEach(function (e) {
      var before = base ? dkey(e) < dkey(base) : true, isBase = e === base, r = { e: e, label: TYPE_LABEL[e.type], amount: amtOf(e), isBase: isBase, before: before && !isBase };
      var sec = /담보가등기/.test(NS(e.purpose));
      if (e.type === 'mortgage') { r.result = '소멸'; r.reason = '저당권은 순위와 관계없이 매각으로 소멸'; r.basis = ['sale_mortgage']; }
      else if (e.type === 'prov_reg' && sec) { r.result = '소멸'; r.reason = '담보가등기는 매각으로 소멸, 채권신고 필요'; r.basis = ['prov_security_end']; }
      else if (e.type === 'attach' || e.type === 'seizure' || e.type === 'auction' || e.type === 'public_sale') { r.result = '소멸'; r.reason = isBase ? '가장 앞선 기준 등기. 매수인이 인수하지 않는 부담으로 말소 촉탁 대상' : '매수인이 인수하지 않는 부담으로 말소 촉탁 대상'; r.basis = ['sale_cancel']; }
      else if (e.type === 'jeonse') {
        if (r.before) { r.result = '인수 가능'; r.reason = '기준 등기보다 앞선 전세권. 전세권자가 배당요구하면 소멸'; r.basis = ['sale_take']; if (r.amount) takeover += r.amount; }
        else { r.result = '소멸'; r.reason = '저당권·압류·가압류에 대항할 수 없는 전세권'; r.basis = ['sale_other']; }
      } else if (e.type === 'lease' || e.type === 'superficies' || e.type === 'easement') {
        if (r.before) { r.result = '인수 가능'; r.reason = '기준 등기보다 앞선 ' + r.label + (e.type === 'lease' ? '. 보증금을 다 받지 못하면 소멸하지 않음' : ''); r.basis = e.type === 'lease' ? ['sale_take', 'tenancy_survive'] : ['sale_take']; if (e.type === 'lease' && r.amount) takeover += r.amount; }
        else { r.result = '소멸'; r.reason = '저당권·압류·가압류에 대항할 수 없는 ' + r.label; r.basis = ['sale_other']; }
      } else if (e.type === 'injunction') {
        if (r.before) { r.result = '인수 위험'; r.reason = '기준 등기보다 앞선 가처분. 가처분채권자가 본안에서 이기면 매수인 권리가 대항하지 못할 수 있음'; r.basis = ['injunction_reg', 'p_2018da276218']; }
        else { r.result = '확인 필요'; r.reason = '후순위 가처분. 원칙적으로 말소 촉탁 대상이나 피보전권리(예: 건물철거·토지인도)를 확인'; r.basis = ['sale_cancel']; }
      } else if (e.type === 'prov_reg') {
        if (r.before) { r.result = '인수 위험'; r.reason = '기준 등기보다 앞선 가등기. 본등기가 되면 매수인 소유권이 말소될 수 있음'; r.basis = ['prov_reg_rank', 'prov_reg_delete']; }
        else { r.result = '소멸'; r.reason = '후순위 가등기로 말소 촉탁 대상'; r.basis = ['sale_cancel']; }
      } else if (e.type === 'trust') { r.result = '확인 필요'; r.reason = '신탁재산에는 원칙적으로 경매·강제집행을 할 수 없어 사건의 집행 근거를 확인'; r.basis = ['trust_exec']; }
      else if (e.type === 'repurchase' || e.type === 'warning' || e.type === 'prohibit' || e.type === 'rehab') { r.result = r.before ? '인수 위험' : '확인 필요'; r.reason = r.label + ' 기록. 내용과 기간 확인'; r.basis = []; }
      else { r.result = '확인 필요'; r.reason = r.label; r.basis = []; }
      rows.push(r);
    });
    if (!base) notes.push('저당권·압류·가압류·담보가등기·경매개시결정 같은 기준 등기가 없습니다. 이 경우 지상권·지역권·전세권·등기된 임차권은 매수인이 인수하는 쪽으로 봐야 합니다.');
    notes.push('등기부에 나오지 않는 부담: 전입일이 기준 등기보다 앞선 임차인(대항력)은 보증금을 다 받지 못하면 매수인이 떠안을 수 있습니다. 유치권도 등기부에 나오지 않습니다.');
    notes.push('배당요구 종기(첫 매각기일 이전으로 정해 공고)와 매각물건명세서의 임차인 현황을 확인하십시오.');
    if (rep.owners.length > 1) notes.push('공유 지분만 매각되는 사건이면 다른 공유자가 최고가와 같은 가격으로 우선매수를 신고할 수 있습니다.');
    return { base: base, rows: rows, takeover: takeover, notes: notes, noteBasis: ['tenancy_opposability', 'tenancy_survive', 'lien', 'dividend_end'].concat(rep.owners.length > 1 ? ['share_auction'] : []) };
  }

  /* ------------------------------------------------------------------ */
  /* 6-5. 위험 시나리오(가능성 순)                                          */
  /* ------------------------------------------------------------------ */
  var IMPACT_W = { '치명': 3, '큼': 2, '보통': 1 };
  function buildScenarios(doc, rep, c) {
    var P = rep.purpose, S = [], flags = rep.flags;
    var has = function (id) { return flags.filter(function (f) { return f.id === id; }); };
    function sigs(list) { return list.filter(Boolean); }
    function sg(text, w, ref) { return { text: text, w: w, ref: ref || '' }; }
    function add(id, title, impact, s, consequence, mitigate, purposes) {
      if (purposes && purposes.indexOf(P) < 0) return;
      s = sigs(s); if (!s.length) return;
      var score = Math.min(100, s.reduce(function (t, x) { return t + x.w; }, 0));
      S.push({ id: id, title: title, impact: impact, score: score, likelihood: score >= 70 ? '높음' : score >= 40 ? '중간' : '낮음', signals: s.sort(function (a, b) { return b.w - a.w; }), consequence: consequence, mitigate: mitigate, rank: IMPACT_W[impact] * score });
    }
    var risky = rep.mortInfo.filter(function (m) { return /대부|유동화|개인/.test(m.tier); });
    var mtr = rep.mortInfo.filter(function (m) { return m.transferred; });
    var auc = has('auction'), inj = has('injunction'), prov = has('prov_reg'), trust = has('trust'), lreg = has('lease_reg'), lpast = has('lease_reg_past');
    var fraudTop = rep.fraud[0];
    var ratio = rep.money.ratio;
    var refOf = function (f) { return f && f.entries && f.entries[0] ? (f.entries[0].sec === 'gap' ? '갑' : '을') + f.entries[0].rank : ''; };

    add('auction', '경매로 넘어갈 가능성', P === 'credit' ? '큼' : '치명', [
      auc.length ? sg('경매개시결정이 유효함(이미 진행 중)', 100, refOf(auc[0])) : null,
      mtr.length ? sg('근저당권 이전(채권 매각) ' + mtr.length + '건', 30, mtr[0].e.sec === 'gap' ? '' : '을' + mtr[0].e.rank) : null,
      c.seiz.length ? sg('압류 ' + c.seiz.length + '건', Math.min(40, 20 * c.seiz.length), (c.seiz[0].sec === 'gap' ? '갑' : '을') + c.seiz[0].rank) : null,
      c.att.length ? sg('가압류 ' + c.att.length + '건', Math.min(40, 20 * c.att.length), '갑' + c.att[0].rank) : null,
      risky.length ? sg('대부업체·개인·채권매입회사 근저당 ' + risky.length + '건', 20, '을' + risky[0].e.rank) : null,
      lreg.length ? sg('보증금 미반환 임차권등기', 25, refOf(lreg[0])) : null,
      c.morts.length >= 3 ? sg('유효 근저당 ' + c.morts.length + '건', 10) : null,
      ratio >= 0.9 ? sg('선순위 부담이 시세에 근접', 15) : null
    ], { lease: '매각되면 보증금은 배당 순위에 따라 일부만 돌려받거나 못 받을 수 있습니다.', buy: '계약하더라도 경매가 계속되면 소유권을 얻지 못할 수 있습니다.', credit: '선행 경매에서 배당 순위가 결정됩니다.', general: '소유자가 바뀌고 후순위 권리는 정리됩니다.' }[P] || '소유자가 바뀌고 후순위 권리는 정리됩니다.', ['법원경매정보로 사건 진행 확인', '근저당 실제 잔액 확인'], ['lease', 'buy', 'credit', 'general']);

    add('deposit', '보증금을 다 돌려받지 못할 가능성', '치명', [
      ratio != null ? sg('선순위 부담+보증금이 시세의 ' + Math.round(ratio * 100) + '%', ratio >= 0.9 ? 50 : ratio >= 0.7 ? 30 : ratio >= 0.5 ? 10 : 0) : null,
      auc.length ? sg('경매 진행 중', 50, refOf(auc[0])) : null,
      trust.length ? sg('신탁 부동산(보증금 반환 의무자 확인 필요)', 40, refOf(trust[0])) : null,
      lreg.length ? sg('이미 보증금을 못 받은 임차인의 임차권등기', 40, refOf(lreg[0])) : null,
      lpast.length ? sg('과거 임차권등기 이력', 15, refOf(lpast[0])) : null,
      c.seiz.length ? sg('조세 등 압류(법정기일에 따라 먼저 배분될 수 있음)', Math.min(30, 15 * c.seiz.length)) : null,
      c.att.length ? sg('가압류', Math.min(20, 10 * c.att.length)) : null,
      has('use_multi').length ? sg('다가구주택(다른 세대 보증금이 앞설 수 있음)', 15) : null,
      has('use_neighborhood').length ? sg('근린생활시설 용도', 15) : null,
      has('gap_pattern').length ? sg('매매와 전세가 같은 때 진행', 25) : null,
      has('new_build').length ? sg('신축(시세 확인 어려움)', 10) : null,
      c.morts.length ? sg('선순위 근저당 ' + c.morts.length + '건(채권최고액 ' + won(rep.money.mortSum) + ')', 10) : null
    ], '보증금이 배당 순위에서 밀리거나 반환 상대가 불분명해질 수 있습니다.', ['전입세대 열람·확정일자 부여 현황', '납세증명서', '전세보증금 반환보증 가입 가능 여부', '선순위 근저당 상환·감액 조건'], ['lease']);

    add('title', '소유권을 잃거나 소유권 분쟁에 휘말릴 가능성', '치명', [
      inj.length ? sg('유효한 가처분', 50 + (/사해/.test(NS(inj[0].quote)) ? 20 : 0), refOf(inj[0])) : null,
      prov.length ? sg('유효한 가등기(본등기 시 뒤 권리 말소 가능)', 50, refOf(prov[0])) : null,
      has('repurchase').length ? sg('환매특약', 40) : null,
      fraudTop && fraudTop.score >= 30 ? sg('사해행위 신호: ' + fraudTop.kind, Math.round(fraudTop.score * 0.6), (fraudTop.act.sec === 'gap' ? '갑' : '을') + fraudTop.act.rank) : null,
      has('warning').length ? sg('예고등기', 30) : null,
      has('acq_judgment').length ? sg('판결로 취득한 이력', 10) : null
    ], { buy: '대금을 치르고도 소유권을 되돌려야 하는 분쟁이 생길 수 있습니다.', lease: '임대인이 바뀌거나 계약 효력을 다투는 상황이 생길 수 있습니다.', auction: '매수 후에도 소유권을 잃을 위험이 남을 수 있습니다.', general: '소유 관계가 바뀔 수 있습니다.' }[P] || '소유 관계가 바뀔 수 있습니다.', ['가처분·가등기 원인과 사건 진행 확인', '말소 조건을 계약서에 명시'], ['buy', 'lease', 'general', 'auction', 'credit']);

    if (rep.fraud.length) add('fraud', '과거 처분이 사해행위로 다투어질 가능성', P === 'buy' || P === 'credit' ? '큼' : '보통', rep.fraud.slice(0, 4).map(function (f) { return sg(f.kind + ': ' + f.signals.slice(0, 2).join(', '), Math.round(f.score * (f.direct ? 1 : 0.7)), (f.act.sec === 'gap' ? '갑' : '을') + f.act.rank); }),
      P === 'credit' ? '채권자취소 소송으로 재산을 되돌릴 수 있는지 검토 대상입니다.' : '처분이 취소되면 소유 관계가 원래대로 돌아갈 수 있습니다.', ['처분 당시 채무 규모', '받은 사람과의 관계·대가 지급', '제척기간(안 날부터 1년, 있은 날부터 5년)']);

    if (P === 'auction') add('takeover', '매수인이 떠안을 권리가 있을 가능성', '치명', rep.auction.rows.filter(function (r) { return /인수/.test(r.result); }).map(function (r) { return sg(r.label + ' ' + (r.amount ? won(r.amount) : '') + ' (' + r.result + ')', /위험/.test(r.result) ? 50 : 35, (r.e.sec === 'gap' ? '갑' : '을') + r.e.rank); }).concat([sg('등기부 밖 대항력 임차인·유치권은 아직 확인 전', 10)]),
      '낙찰가 외에 추가로 부담할 금액이나 소유권 상실 위험이 생깁니다.', ['매각물건명세서', '전입세대 열람', '현황조사서']);

    add('tax', '세금이 먼저 배분될 가능성', '큼', [
      c.seiz.filter(function (e) { return /국세|지방세/.test(seizureHolderType((roleName(e, /권리자/) || {}).name || '')); }).length ? sg('국세·지방세 압류', 30) : null,
      c.seiz.length ? sg('압류 ' + c.seiz.length + '건', 15) : null,
      c.lastX && c.lastX.type !== 'preserve' && c.lastX.type !== 'trust' && daysBetween(c.lastX.date, rep.base) <= 730 ? sg('최근 2년 안에 소유자 변경(이전 소유자 체납 국세 일부가 우선할 수 있음)', 10) : null
    ], '경매·공매에서 세금이 보증금·채권보다 먼저 배분되어 받을 몫이 줄 수 있습니다.', ['국세·지방세 완납증명 또는 미납 열람 동의'], ['lease', 'credit', 'auction', 'general']);

    add('owner_stress', '소유자 자금 사정이 나쁠 가능성', '보통', [
      c.att.length ? sg('가압류 ' + c.att.length + '건', Math.min(40, 20 * c.att.length)) : null,
      c.seiz.length ? sg('압류 ' + c.seiz.length + '건', Math.min(30, 15 * c.seiz.length)) : null,
      risky.length ? sg('대부업체·개인 등 근저당', 20) : null,
      has('mort_increase').length ? sg('근저당 한도 증액', 10) : null,
      c.morts.length >= 3 ? sg('근저당 다수', 15) : null,
      has('attach_repeat').length ? sg('가압류 반복 이력', 15) : null,
      mtr.length ? sg('근저당권 이전(채권 매각)', 20) : null,
      auc.length ? sg('경매 진행', 40) : null
    ], '추가 압류·경매로 이어질 수 있습니다.', ['최근 등기 재열람', '체납·대출 연체 여부']);

    add('authority', '계약 상대방의 권한이 부족할 가능성', '큼', [
      has('party_mismatch').length ? sg('계약 상대방이 등기부상 소유자가 아님', 80) : null,
      trust.length ? sg('신탁(수탁자 동의 필요)', 40, refOf(trust[0])) : null,
      has('co_owned').length ? sg('공유 소유', 30) : null,
      has('corp_owner').length ? sg('법인 소유', 15) : null
    ], '권한 없는 사람과 맺은 계약은 효력을 다투게 될 수 있습니다.', ['소유자 신분증 대조', '위임장·인감증명서', '신탁원부·수탁자 동의서'], ['lease', 'buy']);

    add('overprice', '시세보다 비싸게 계약할 가능성', '보통', [
      has('new_build').length ? sg('신축', 25) : null,
      has('frequent_transfer').length ? sg('단기간 반복 거래', 30) : null,
      has('gap_pattern').length ? sg('매매·전세 동시 진행', 30) : null,
      has('sameday_mortgage').filter(function (f) { return f.level === 'high'; }).length ? sg('거래가액에 가까운 대출', 20) : null,
      has('use_neighborhood').length ? sg('근린생활시설', 10) : null
    ], '보증금이나 매매대금이 실제 가치보다 높게 잡힐 수 있습니다.', ['인근 실거래가', '감정평가 또는 공시가격'], ['lease', 'buy']);

    S.sort(function (a, b) { return b.rank - a.rank || b.score - a.score; });
    return S;
  }

  /* ------------------------------------------------------------------ */
  /* 6-6. 여러 등기부 복합 분석                                             */
  /* ------------------------------------------------------------------ */
  function jibunOf(addr) {
    var t = String(addr || '').replace(/\s+/g, ' ');
    var m = t.match(/([가-힣0-9]+(?:동|리|가))\s+(산\s*)?(\d+(?:-\d+)?)(?:번지)?/);
    return m ? m[1] + ' ' + (m[2] ? '산' : '') + m[3] : '';
  }
  function personKey(name, regno) { return NS(name) + '|' + String(regno || '').slice(0, 6); }
  function analyzeMulti(items, opt) {
    opt = opt || {};
    var P = opt.purpose || 'general', findings = [];
    function F(id, level, title, o) { findings.push({ id: id, level: level, title: title, kind: o.kind || '사실', docs: o.docs || [], detail: o.detail || '', meaning: o.meaning || '', check: o.check || [], basis: o.basis || [], quote: o.quote || '' }); }
    items.forEach(function (it, i) { it.idx = i; it.jibun = jibunOf(it.doc.address); });
    // 1) 같은 지번의 토지와 건물
    items.forEach(function (a) {
      items.forEach(function (b) {
        if (a === b || a.doc.kind !== '토지' || !(b.doc.kind === '건물' || b.doc.kind === '집합건물') || !a.jibun || a.jibun !== b.jibun) return;
        var lo = a.rep.owners.map(function (o) { return NS(o.name); }), bo = b.rep.owners.map(function (o) { return NS(o.name); });
        var overlap = lo.filter(function (x) { return bo.indexOf(x) >= 0; });
        if (lo.length && bo.length && !overlap.length) F('land_bldg_owner', P === 'auction' || P === 'buy' ? 'critical' : 'high', '같은 지번의 토지와 건물 소유자가 다릅니다', { docs: [a.name, b.name], detail: '토지: ' + a.rep.owners.map(function (o) { return o.name; }).join(', ') + ' / 건물: ' + b.rep.owners.map(function (o) { return o.name; }).join(', '), meaning: '건물이 토지를 쓸 권리(법정지상권, 토지 임대차 등)가 있는지에 따라 철거·지료 분쟁이 생길 수 있습니다. 토지와 건물이 언제, 어떤 원인으로 다른 사람에게 갈렸는지가 핵심입니다.', check: ['토지·건물이 갈린 원인과 시점', '토지 임대차계약·지료 약정', '건물 철거 소송 여부'], basis: ['statutory_superficies', 'p_custom_superficies'] });
        var bp = b.doc.gap.filter(function (e) { return e.type === 'preserve' && e.date; })[0];
        var lm = a.doc.eul.filter(function (e) { return e.type === 'mortgage' && !e.cancelled && e.date; }).sort(byKey)[0];
        if (bp && lm && lm.date < bp.date) F('land_mort_before_bldg', P === 'auction' ? 'high' : 'caution', '토지 근저당이 건물 보존등기보다 먼저입니다', { docs: [a.name, b.name], detail: '토지 근저당 ' + lm.date + ' / 건물 보존 ' + bp.date, meaning: '근저당 설정 당시 건물이 없던 토지라면, 토지 경매에서 건물이 함께 매각되거나 건물의 토지 사용권이 문제 될 수 있습니다.', check: ['근저당 설정 당시 건물 존재 여부'], basis: ['bulk_auction', 'statutory_superficies'] });
      });
    });
    // 2) 같은 소유자
    var byOwner = {};
    items.forEach(function (it) { it.rep.owners.forEach(function (o) { var k = personKey(o.name, o.regno); (byOwner[k] = byOwner[k] || { name: o.name, docs: [] }).docs.push(it); }); });
    Object.keys(byOwner).forEach(function (k) {
      var g = byOwner[k]; if (g.docs.length < 2) return;
      var sum = g.docs.reduce(function (s, it) { return s + (it.rep.money.mortSum || 0); }, 0);
      var att = g.docs.reduce(function (s, it) { return s + it.rep.money.attSum; }, 0);
      var leaseDocs = g.docs.filter(function (it) { return it.doc.eul.some(function (e) { return e.type === 'lease'; }); });
      if (leaseDocs.length >= 2) F('multi_lease', 'high', g.name + ' 소유 부동산 ' + leaseDocs.length + '곳에 임차권등기가 있습니다', { kind: '추론', docs: leaseDocs.map(function (it) { return it.name; }), meaning: '같은 임대인의 여러 집에서 임차인이 보증금을 제때 돌려받지 못한 이력입니다. 보증금 반환 능력을 매우 신중히 확인해야 합니다.', basis: ['lease_order'] });
      F('same_owner', 'info', g.name + ' 소유 부동산 ' + g.docs.length + '건', { docs: g.docs.map(function (it) { return it.name; }), detail: '근저당 채권최고액 합계 ' + won(sum) + (att ? ', 가압류 청구금액 합계 ' + won(att) : ''), meaning: '한 사람이 여러 부동산을 가진 경우 전체 부채와 담보 상황을 함께 봐야 합니다.' });
    });
    // 3) 짧은 기간 여러 부동산 처분
    var acts = [];
    items.forEach(function (it) {
      var owns = it.doc.gap.filter(function (e) { return (e.type === 'preserve' || e.type === 'transfer' || e.type === 'trust') && e.date; }).sort(byKey);
      owns.forEach(function (x, i) {
        if (x.type === 'preserve' || i === 0) return;
        var prev = owns.slice(0, i).filter(function (o) { return !o.cancelled; }).pop();
        (prev ? ownersOf(prev) : []).forEach(function (f) { acts.push({ it: it, e: x, from: f, to: ownersOf(x).map(function (t) { return t.name; }) }); });
      });
    });
    var done = {};
    acts.forEach(function (a) {
      var grp = acts.filter(function (b) { return b.it !== a.it && personKey(b.from.name, b.from.regno) === personKey(a.from.name, a.from.regno) && Math.abs(daysBetween(a.e.date, b.e.date)) <= 30; });
      if (!grp.length) return;
      var all = [a].concat(grp), key = all.map(function (x) { return x.it.idx + ':' + x.e.rank; }).sort().join(',');
      if (done[key]) return; done[key] = 1;
      var sameTo = uniq(all.map(function (x) { return NS(x.to.join(',')); })).length === 1;
      var debts = 0;
      items.forEach(function (it) { it.doc.gap.forEach(function (d) { if ((d.type === 'attach' || d.type === 'seizure' || d.type === 'auction') && d.date && all.some(function (x) { return d.date <= x.e.date && (!d.cancelled || !d.cancelDate || d.cancelDate > x.e.date); })) debts++; }); });
      F('bulk_disposal', debts ? 'critical' : 'high', a.from.name + josa(a.from.name, '이', '가') + ' 30일 안에 부동산 ' + all.length + '건을 넘겼습니다', { kind: '추론', docs: all.map(function (x) { return x.it.name; }), detail: all.map(function (x) { return x.it.name + ' ' + x.e.date + ' ' + x.e.causeText + ' → ' + x.to.join(', '); }).join(' / ') + (sameTo ? ' (받은 사람 같음)' : '') + (debts ? ' / 처분 당시 가압류·압류·경매 ' + debts + '건' : ''), meaning: '재산을 한꺼번에 넘긴 형태로, 채무가 많았다면 사해행위로 다투어질 수 있는 대표적인 신호입니다. 등기부만으로 채무초과 여부는 알 수 없습니다.', check: ['처분 당시 채무 규모와 남은 재산', '받은 사람과의 관계·대가 지급'], basis: ['fraud_406', 'p_fraud_sole'] });
    });
    // 3-2) 다른 등기부에 걸린 채무 신호가 있는 상태에서의 처분
    acts.forEach(function (a) {
      var fk = personKey(a.from.name, a.from.regno), hits = [];
      items.forEach(function (it) {
        if (it === a.it) return;
        if (!it.rep.owners.some(function (o) { return personKey(o.name, o.regno) === fk || NS(o.name) === NS(a.from.name); }) && !it.doc.gap.some(function (e) { return ownersOf(e).some(function (o) { return NS(o.name) === NS(a.from.name); }); })) return;
        it.doc.gap.forEach(function (d) {
          if (!(d.type === 'attach' || d.type === 'seizure' || d.type === 'auction') || !d.date) return;
          if (d.date <= a.e.date && daysBetween(d.date, a.e.date) <= 730 && (!d.cancelled || !d.cancelDate || d.cancelDate > a.e.date)) hits.push({ it: it, d: d });
        });
      });
      if (hits.length) F('cross_debt_disposal', 'critical', a.from.name + josa(a.from.name, '이', '가') + ' 다른 부동산에 ' + (function (t) { return t + josa(t, '이', '가'); })(uniq(hits.map(function (h) { return TYPE_LABEL[h.d.type]; })).join('·')) + ' 걸린 상태에서 ' + a.it.name + josa(a.it.name, '을', '를') + ' 넘겼습니다', { kind: '추론', docs: [a.it.name].concat(uniq(hits.map(function (h) { return h.it.name; }))), detail: a.it.name + ' ' + a.e.date + ' ' + a.e.causeText + ' → ' + a.to.join(', ') + ' / ' + hits.map(function (h) { return h.it.name + ' 갑' + h.d.rank + ' ' + TYPE_LABEL[h.d.type] + ' ' + h.d.date; }).join(', '), meaning: '채무 문제가 드러난 뒤 다른 재산을 넘긴 형태로, 사해행위로 다투어질 수 있는 신호입니다. 처분 당시 남은 재산과 채무 규모는 등기부만으로 알 수 없습니다.', check: ['처분 당시 채무 규모와 남은 재산', '받은 사람과의 관계·대가 지급'], basis: ['fraud_406', 'p_fraud_bad_faith'] });
    });
    // 4) 같은 채권자·권리자(종류가 달라도 같은 이름이면 묶는다)
    var byCred = {};
    items.forEach(function (it) {
      it.doc.gap.concat(it.doc.eul).forEach(function (e) {
        if (e.cancelled || !(e.type === 'attach' || e.type === 'seizure' || e.type === 'injunction' || e.type === 'mortgage')) return;
        var h = roleName(e, e.type === 'mortgage' ? /저당권자/ : e.type === 'seizure' ? /권리자/ : /채권자/); if (!h) return;
        var k = (e.type === 'mortgage' ? 'm|' : 'd|') + NS(h.name); (byCred[k] = byCred[k] || { mortgage: e.type === 'mortgage', name: h.name, hits: [] }).hits.push({ it: it, e: e });
      });
    });
    Object.keys(byCred).forEach(function (k) {
      var g = byCred[k], docs = uniq(g.hits.map(function (h) { return h.it.name; }));
      if (docs.length < 2) return;
      var types = uniq(g.hits.map(function (h) { return TYPE_LABEL[h.e.type] + (h.e.type === 'injunction' && /사해/.test(NS(h.e.holder + h.e.cause)) ? '(사해행위취소)' : ''); }));
      var fraudLink = g.hits.some(function (h) { return h.e.type === 'injunction' && /사해/.test(NS(h.e.holder + h.e.cause)); });
      F('same_creditor', g.mortgage ? 'info' : fraudLink ? 'high' : 'caution', g.name + josa(g.name, '이', '가') + ' 여러 부동산에 ' + types.join('·') + josa(types.join('·'), '을', '를') + ' 걸었습니다', { docs: docs, detail: g.hits.map(function (h) { return h.it.name + ' ' + (h.e.sec === 'gap' ? '갑' : '을') + h.e.rank + ' ' + TYPE_LABEL[h.e.type]; }).join(', '), meaning: g.mortgage ? '같은 금융기관이 여러 부동산을 함께 담보로 잡았습니다.' : fraudLink ? '같은 채권자가 한 부동산에는 보전처분을, 넘어간 다른 부동산에는 사해행위취소 가처분을 걸었습니다. 채권자가 처분을 사해행위로 보고 다투는 정황입니다.' : '같은 채권자가 소유자의 여러 재산을 묶었습니다. 채권 규모가 크거나 회수 의지가 강할 수 있습니다.', basis: fraudLink ? ['fraud_406'] : [] });
    });
    // 5) 공동담보목록
    var joint = {};
    items.forEach(function (it) { it.rep.mortInfo.forEach(function (m) { if (m.joint && m.joint !== '있음') (joint[m.joint] = joint[m.joint] || []).push({ it: it, m: m }); }); });
    Object.keys(joint).forEach(function (j) {
      var g = joint[j], docs = uniq(g.map(function (x) { return x.it.name; }));
      if (docs.length >= 2) F('joint_link', 'info', '공동담보목록 ' + j + '로 묶인 부동산입니다', { docs: docs, detail: g.map(function (x) { return x.it.name + ' 을' + x.m.e.rank + ' ' + won(x.m.amt); }).join(', '), meaning: '한 대출이 여러 부동산을 함께 담보로 잡고 있습니다. 경매 시 채권최고액이 부동산별로 나뉘어 배당될 수 있어 부동산별 부담을 따로 계산해야 합니다.', basis: ['joint_mortgage'] });
    });
    items.forEach(function (it) { it.rep.mortInfo.forEach(function (m) { if (m.joint && m.joint !== '있음' && joint[m.joint].length < 2) F('joint_missing', 'info', it.name + ': 공동담보목록 ' + m.joint + '의 다른 부동산 등기부가 없습니다', { docs: [it.name], meaning: '함께 담보로 잡힌 다른 부동산의 등기부를 추가하면 교차 분석할 수 있습니다.', check: ['공동담보목록 발급'] }); }); });
    // 6) 집합건물 대지권과 토지
    items.forEach(function (b) {
      if (b.doc.kind !== '집합건물' || !b.jibun) return;
      var land = items.filter(function (a) { return a.doc.kind === '토지' && a.jibun === b.jibun; })[0];
      if (land && land.rep.currentRights.length) F('land_rights_for_unit', 'caution', '대지(토지) 등기부에 남은 권리가 있습니다', { docs: [land.name, b.name], detail: land.rep.currentRights.map(function (e) { return TYPE_LABEL[e.type] + ' ' + (e.sec === 'gap' ? '갑' : '을') + e.rank; }).join(', '), meaning: '집합건물 대지에 건물과 별개인 권리가 남아 있으면 대지권 가치와 경매 결과에 영향을 줄 수 있습니다.', basis: ['aggregate_bldg'] });
    });
    // 통합 타임라인·이야기
    var timeline = [];
    items.forEach(function (it) { it.rep.story.events.forEach(function (ev) { timeline.push({ doc: it.name, ev: ev }); }); });
    timeline.sort(function (a, b) { return (a.ev.date || '9999') < (b.ev.date || '9999') ? -1 : (a.ev.date || '9999') > (b.ev.date || '9999') ? 1 : 0; });
    // 시나리오 통합(문서별 최고 점수 + 복합 신호)
    var scen = {};
    items.forEach(function (it) { it.rep.scenarios.forEach(function (s) { if (!scen[s.id] || scen[s.id].rank < s.rank) scen[s.id] = Object.assign({}, s, { doc: it.name }); }); });
    var multiScen = Object.keys(scen).map(function (k) { return scen[k]; });
    var bulk = findings.filter(function (f) { return f.id === 'bulk_disposal'; });
    if (bulk.length) multiScen.push({ id: 'multi_fraud', title: '여러 부동산 일괄 처분이 사해행위로 다투어질 가능성', impact: '큼', score: bulk[0].level === 'critical' ? 75 : 50, likelihood: bulk[0].level === 'critical' ? '높음' : '중간', signals: bulk.map(function (f) { return { text: f.title, w: 50, ref: '' }; }), consequence: '처분이 취소되면 재산이 원래 소유자에게 돌아가 채권자들의 집행 대상이 됩니다.', mitigate: ['처분 당시 채무 규모', '받은 사람과의 관계'], rank: 2 * (bulk[0].level === 'critical' ? 75 : 50) });
    var lb = findings.filter(function (f) { return f.id === 'land_bldg_owner'; });
    if (lb.length) multiScen.push({ id: 'multi_superficies', title: '토지·건물 소유자 불일치로 철거·지료 분쟁이 생길 가능성', impact: P === 'auction' || P === 'buy' ? '치명' : '큼', score: 55, likelihood: '중간', signals: lb.map(function (f) { return { text: f.detail, w: 55, ref: '' }; }), consequence: '건물의 토지 사용권이 인정되지 않으면 철거나 지료 청구로 이어질 수 있습니다.', mitigate: ['토지·건물이 갈린 경위', '토지 임대차·지료 약정'], rank: (P === 'auction' || P === 'buy' ? 3 : 2) * 55 });
    multiScen.sort(function (a, b) { return b.rank - a.rank; });
    var LVn = { critical: 4, high: 3, caution: 2, info: 1 };
    findings.sort(function (a, b) { return LVn[b.level] - LVn[a.level]; });
    return { items: items, findings: findings, timeline: timeline, scenarios: multiScen };
  }

  function oneLine(s) { return String(s || '').replace(/\s*\n\s*/g, ' ').trim(); }

  /* ------------------------------------------------------------------ */
  /* 7. Claude 추론 요청문                                                */
  /* ------------------------------------------------------------------ */
  function entryLine(e) {
    return [(e.sec === 'gap' ? '갑' : '을') + e.rank, e.status + (e.statusWhy ? '(' + e.statusWhy + ')' : ''), oneLine(e.purpose), oneLine(e.receipt), oneLine(e.cause), oneLine(e.holder).slice(0, 260)].join(' | ');
  }
  function buildAIPrompt(doc, rep, opt) {
    opt = opt || {};
    var L = [];
    L.push('당신은 한국 부동산 등기사항증명서 권리분석을 돕는 검토자입니다. 아래는 브라우저 판독기가 PDF에서 읽어 낸 등기 내용과 규칙 기반 특이사항입니다.');
    L.push('목적: ' + rep.purposeLabel + ' / 판독 기준일: ' + rep.base);
    if (opt.partyName) L.push('계약 상대방(사용자 입력): ' + opt.partyName);
    if (opt.deposit) L.push('보증금 또는 매매대금(사용자 입력): ' + won(opt.deposit));
    if (opt.marketPrice) L.push('시세(사용자 입력): ' + won(opt.marketPrice));
    L.push('');
    L.push('[문서] ' + (doc.title || '') + ' / 종류 ' + (doc.kind || '미상') + ' / 소재지 ' + (doc.address || '미상') + ' / 고유번호 ' + (doc.uniqueNo || '미상') + ' / 열람일시 ' + (doc.viewedAtText || '미상') + (doc.viewOnly ? ' / 열람용' : ''));
    L.push('[표제부 요약] 용도 ' + (rep.use || '미상') + ', 전유면적 ' + (rep.area ? rep.area + '㎡' : '미상') + ', 대지권 ' + (rep.daejiType || '') + ' ' + (rep.daejiRatio || '표시 없음'));
    L.push('[표제부 원문]\n' + (doc.pyojeText || '(없음)').slice(0, 3000));
    L.push('[현재 소유자(' + rep.ownersSrc + ')] ' + (rep.owners.map(function (o) { return o.name + ' ' + (o.share || ''); }).join(', ') || '미상'));
    L.push('[갑구] 순위 | 상태 | 등기목적 | 접수 | 등기원인 | 권리자 및 기타사항');
    doc.gap.forEach(function (e) { L.push(entryLine(e)); });
    if (!doc.gap.length) L.push('(읽지 못함 또는 기록 없음)');
    L.push('[을구] 순위 | 상태 | 등기목적 | 접수 | 등기원인 | 권리자 및 기타사항');
    doc.eul.forEach(function (e) { L.push(entryLine(e)); });
    if (!doc.eul.length) L.push(doc.empty.eul ? '(기록사항 없음)' : '(읽지 못함 또는 기록 없음)');
    L.push('[금액] 유효 근저당 채권최고액 합계 ' + won(rep.money.mortSum) + ', 전세금 ' + won(rep.money.jeonSum) + ', 임차보증금 ' + won(rep.money.leaseSum) + ', 가압류 청구금액 ' + won(rep.money.attSum) + ', 압류 ' + rep.money.seizureCount + '건');
    L.push('[경매 기준 등기 후보(가장 앞선 저당권·압류·가압류·담보가등기·경매개시결정)] ' + (rep.baseRight ? entryLine(rep.baseRight) : '없음'));
    if (rep.purpose === 'auction') rep.auction.rows.forEach(function (r) { L.push('  - ' + (r.e.sec === 'gap' ? '갑' : '을') + r.e.rank + ' ' + r.label + ': ' + r.result + ' (' + r.reason + ')'); });
    L.push('[규칙 판독 특이사항]');
    rep.flags.forEach(function (f) { L.push('- [' + LV_LABEL[f.level] + '/' + f.kind + '] ' + f.title + (f.detail ? ' (' + f.detail + ')' : '')); });
    L.push('[사해행위 신호(규칙)]');
    if (!rep.fraud.length) L.push('(없음)');
    rep.fraud.forEach(function (c) { L.push('- ' + (c.act.sec === 'gap' ? '갑' : '을') + c.act.rank + ' ' + c.kind + ' 점수' + c.score + ': ' + c.signals.join(', ') + (c.counter.length ? ' / 반대 사정: ' + c.counter.join(', ') : '')); });
    L.push('[위험 시나리오(규칙 점수, 확률 아님)]');
    rep.scenarios.forEach(function (sc) { L.push('- ' + sc.title + ' 가능성 ' + sc.likelihood + '(' + sc.score + ') 영향 ' + sc.impact + ': ' + sc.signals.map(function (g) { return g.text; }).join(', ')); });
    L.push('');
    L.push(AI_RULES(rep.purposeLabel));
    L.push('');
    L.push('다음 JSON 하나만 출력하십시오:');
    L.push(AI_SCHEMA(rep.purpose === 'auction'));
    return L.join('\n');
  }
  function AI_RULES(purposeLabel) {
    return ['지시:',
      '1. 위 자료에 있는 사실만 근거로 삼으십시오. 자료에 없는 사실(임차인 존재, 체납액, 시세, 대출 잔액, 당사자 관계 등)을 있는 것처럼 쓰지 마십시오. 모르는 것은 "확인 필요"로 남기십시오.',
      '2. 규칙 판독이 놓친 특이사항, 판독 오류로 보이는 부분(말소 여부 오판, 금액 오독 등), 여러 등기의 순서·시점·권리자 조합에서 읽히는 사정을 찾으십시오.',
      '3. 위험 시나리오는 "일어날 가능성"과 "일어났을 때 피해"를 함께 따져 큰 것부터 정렬하십시오. 각 시나리오에 근거 순위번호, 왜 그렇게 보는지, 그렇게 되면 무엇이 문제인지, 무엇을 확인하면 가능성을 줄이거나 확정할 수 있는지를 쓰십시오.',
      '4. 사해행위 가능성은 등기부만으로 채무초과·사해의사·수익자 인식을 알 수 없다는 한계를 밝히고, 신호와 반대 사정을 함께 적으십시오. 성씨가 같다는 이유만으로 가족이라고 단정하지 마십시오.',
      '5. story_easy는 법률 용어를 모르는 사람도 이해하도록 시간순으로, 짧은 문장으로 쓰십시오. 근저당은 "집을 담보로 빌린 돈", 가압류는 "받을 돈을 지키려고 묶어 둔 것"처럼 풀어 쓰십시오.',
      '6. 각 추론에 근거 순위번호를 적고 사실과 추론을 구분하십시오. 결과를 보장하거나 단정하는 표현을 쓰지 마십시오. 법조문 번호나 판례 번호는 쓰지 마십시오. 채권최고액이 대출 원금의 몇 퍼센트라는 식의 일반화도 하지 마십시오.',
      '7. 목적(' + purposeLabel + ')의 관점에서 지금 할 일을 우선순위대로 제시하십시오.'].join('\n');
  }
  function AI_SCHEMA(auction) {
    return '{"summary":"3문장 이내 총평","risk":"위험|주의|확인|낮음","story_easy":"쉬운 말로 쓴 시간순 경과(7문장 이내)",' +
      '"scenarios":[{"title":"일어날 수 있는 일","likelihood":"높음|중간|낮음","impact":"치명|큼|보통","basis":["갑3","을1-1"],"why":"그렇게 보는 이유","what_if":"그렇게 되면","how_to_check":"확인 방법"}],' +
      '"fraud":{"assessment":"사해행위 가능성 판단과 등기부의 한계","acts":[{"basis":["갑4"],"why":"신호","counter":"반대 사정"}]},' +
      (auction ? '"auction":{"base":"인수·소멸을 가르는 기준 등기와 이유","takeover":["매수인이 떠안을 수 있는 권리와 이유"],"extinguish":["소멸하는 권리"],"cautions":["등기부 밖 확인 사항"]},' : '') +
      '"missed":[{"title":"규칙 판독이 놓친 항목","basis":["갑2"],"why":"설명"}],"parse_doubts":[{"basis":["을2"],"doubt":"판독 오류 의심 내용"}],"actions":["우선순위 순 할 일"],"questions":["소유자·중개인에게 물어볼 질문"]}';
  }
  function buildMultiPrompt(items, multi, opt) {
    opt = opt || {};
    var L = [], purposeLabel = PURPOSES[opt.purpose || 'general'];
    L.push('당신은 한국 부동산 등기사항증명서 권리분석을 돕는 검토자입니다. 서로 관련 있을 수 있는 등기부 ' + items.length + '건을 함께 검토합니다.');
    L.push('목적: ' + purposeLabel + ' / 판독 기준일: ' + (opt.baseDate || ''));
    items.forEach(function (it, i) {
      L.push('');
      L.push('[문서 ' + (i + 1) + ': ' + it.name + '] 종류 ' + (it.doc.kind || '미상') + ' / 소재지 ' + (it.doc.address || '미상') + ' / 지번키 ' + (it.jibun || '-') + ' / 현재 소유자 ' + (it.rep.owners.map(function (o) { return o.name + (o.regno ? '(' + o.regno + ')' : ''); }).join(', ') || '미상'));
      it.doc.gap.concat(it.doc.eul).forEach(function (e) { L.push('  ' + entryLine(e).slice(0, 360)); });
    });
    L.push('');
    L.push('[규칙 교차 판독]');
    if (!multi.findings.length) L.push('(없음)');
    multi.findings.forEach(function (f) { L.push('- [' + LV_LABEL[f.level] + '] ' + f.title + (f.detail ? ' (' + f.detail + ')' : '')); });
    L.push('');
    L.push(AI_RULES(purposeLabel));
    L.push('8. 문서 사이의 관계(같은 지번의 토지·건물, 같은 소유자, 같은 채권자, 공동담보, 같은 날 처분)를 찾아 함께 해석하십시오. 근거는 "문서번호-갑3"처럼 적으십시오.');
    L.push('');
    L.push('다음 JSON 하나만 출력하십시오:');
    L.push(AI_SCHEMA(opt.purpose === 'auction').replace('"summary":"3문장 이내 총평"', '"summary":"3문장 이내 종합 총평","relations":[{"docs":[1,2],"relation":"문서 사이 관계","meaning":"의미"}]'));
    return L.join('\n');
  }

  function buildVisionPrompt(pageFrom, pageTo) {
    return '첨부 이미지는 한국 부동산 등기사항증명서의 ' + pageFrom + '~' + pageTo + '쪽입니다. 보이는 그대로 옮겨 적으십시오. 추측으로 채우지 말고 읽을 수 없는 글자는 □로 두십시오.\n' +
      '빨간 실선(가로줄)이 그어진 줄은 말소 표시입니다. 등기 칸 전체에 실선이 그어졌으면 struck을 true로, 일부 줄만 그어졌으면 그 줄을 struck_lines에 적으십시오.\n' +
      '다음 JSON 하나만 출력하십시오:\n' +
      '{"title":"문서 제목","kind":"집합건물|건물|토지","address":"소재지","unique_no":"고유번호","viewed_at":"열람일시 원문","view_only":true,' +
      '"pyoje":[{"sub":"1동의 건물의 표시 등 소제목","text":"그 행의 내용을 칸 구분 | 로"}],' +
      '"gap":[{"rank":"1","purpose":"등기목적","receipt":"접수","cause":"등기원인","holder":"권리자 및 기타사항(줄바꿈은 \\n)","struck":false,"struck_lines":[]}],' +
      '"eul":[ 같은 형식 ],"gap_empty":false,"eul_empty":false,' +
      '"summary":{"owners":[{"name":"","regno":"","share":"","address":"","rank":""}],"gap":[{"rank":"","purpose":""}],"eul":[{"rank":"","purpose":""}]}}\n' +
      '해당 쪽에 없는 부분은 빈 배열로 두십시오. 앞 쪽에서 이어지는 칸(순위번호가 없는 칸)은 rank를 "~"로 적으십시오.';
  }

  // 이미지 판독 결과(여러 묶음)를 parseDocument 결과와 같은 모양으로 합친다.
  function docFromVision(parts) {
    var doc = { title: '', kind: '', address: '', uniqueNo: '', viewedAt: null, viewedAtText: '', office: '', viewOnly: false, issued: false, partial: false, pages: 0, pyoje: [], gap: [], eul: [], empty: {}, summary: null, blocks: [], loose: [], notes: ['이미지 판독'], vision: true };
    function lines(text, struckLines, struckAll) {
      return String(text || '').split('\n').map(function (t) { return { t: t, k: struckAll || (struckLines || []).some(function (s) { return s && NS(s) === NS(t); }) ? 1 : 0 }; });
    }
    function push(list, sec, r) {
      if (!r) return;
      var lastE = list[list.length - 1];
      if ((r.rank === '~' || !r.rank) && lastE) {
        ['purpose', 'receipt', 'cause', 'holder'].forEach(function (k) { if (r[k]) lastE[k] = lastE[k] ? lastE[k] + '\n' + r[k] : r[k]; });
        lastE.holderLines = lastE.holderLines.concat(lines(r.holder, r.struck_lines, r.struck));
        return;
      }
      list.push({ sec: sec, rank: String(r.rank || '').replace(/\s/g, ''), rankNote: '', purpose: r.purpose || '', receipt: r.receipt || '', cause: r.cause || '', holder: r.holder || '', holderLines: lines(r.holder, r.struck_lines, r.struck), struckPurpose: r.struck ? 1 : 0, struckAll: r.struck ? 1 : 0, page: 0, pages: [] });
    }
    parts.forEach(function (p) {
      if (!p) return;
      doc.title = doc.title || p.title || ''; doc.kind = doc.kind || p.kind || ''; doc.address = doc.address || p.address || '';
      doc.uniqueNo = doc.uniqueNo || p.unique_no || ''; if (p.viewed_at && !doc.viewedAtText) { doc.viewedAtText = p.viewed_at; doc.viewedAt = parseDate(p.viewed_at); }
      if (p.view_only) doc.viewOnly = true;
      if (/일부증명서/.test(NS(p.title))) doc.partial = true;
      (p.pyoje || []).forEach(function (r) { doc.pyoje.push({ sub: NS(r.sub), cells: [{ text: r.text || '', lines: [{ t: r.text || '', k: 0 }], struck: 0 }] }); });
      (p.gap || []).forEach(function (r) { push(doc.gap, 'gap', r); });
      (p.eul || []).forEach(function (r) { push(doc.eul, 'eul', r); });
      if (p.gap_empty) doc.empty.gap = true; if (p.eul_empty) doc.empty.eul = true;
      var s = p.summary;
      if (s && ((s.owners && s.owners.length) || (s.gap && s.gap.length) || (s.eul && s.eul.length))) {
        doc.summary = doc.summary || { owners: [], gap: [], eul: [], empty: {} };
        (s.owners || []).forEach(function (o) { if (o.name) doc.summary.owners.push({ name: o.name, regno: NS(o.regno), share: NS(o.share), address: o.address || '', rank: NS(o.rank) }); });
        (s.gap || []).forEach(function (o) { if (o.rank) doc.summary.gap.push({ rank: NS(o.rank), purpose: o.purpose || '' }); });
        (s.eul || []).forEach(function (o) { if (o.rank) doc.summary.eul.push({ rank: NS(o.rank), purpose: o.purpose || '' }); });
      }
    });
    if (doc.summary && !doc.summary.gap.length && !doc.summary.eul.length) doc.summary = doc.summary.owners.length ? { owners: doc.summary.owners, gap: [], eul: [], empty: {}, ownersOnly: true } : null;
    doc.pyojeText = doc.pyoje.map(function (r) { return '(' + r.sub + ') ' + r.cells[0].text; }).join('\n');
    doc.allText = parts.map(function (p) { return JSON.stringify(p); }).join('\n');
    return doc;
  }

  function basisOf(id) { var b = BASIS[id]; return b ? { cite: b[0], text: b[1] } : null; }

  return {
    NS: NS, extractPdf: extractPdf, extractSegments: extractSegments, buildLines: buildLines, parseDocument: parseDocument,
    analyze: analyze, analyzeMulti: analyzeMulti, jibunOf: jibunOf, buildAIPrompt: buildAIPrompt, buildMultiPrompt: buildMultiPrompt, buildVisionPrompt: buildVisionPrompt, docFromVision: docFromVision,
    parseDate: parseDate, won: won, oneLine: oneLine, basisOf: basisOf, SMALL_TENANT: SMALL_TENANT,
    LV: LV, LV_LABEL: LV_LABEL, TYPE_LABEL: TYPE_LABEL, PURPOSES: PURPOSES, RIGHT_TYPES: RIGHT_TYPES
  };
});
