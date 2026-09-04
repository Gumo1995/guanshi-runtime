/* global window */

(function attachLiuyaoEngineModule(globalScope) {
  "use strict";

  /**
   * 观时六爻确定性排盘内核。
   *
   * 法度：京房八宫、纳甲、三钱法（初爻到上爻）、子初 23:00 换日。
   * 数据与规则参考：
   * - yaomancy/liuyao-engine (Apache-2.0)
   * - Brhiza/mingyu (MIT)
   * 观时采用无依赖 JavaScript 重构，第三方来源与版本记录见 docs/third-party/liuyao.md。
   */

  const READING_SCHEMA = "guanshi-liuyao-reading-v1";
  const HEAVENLY_STEMS = "甲乙丙丁戊己庚辛壬癸".split("");
  const EARTHLY_BRANCHES = "子丑寅卯辰巳午未申酉戌亥".split("");
  const SIX_SPIRITS = ["青龙", "朱雀", "勾陈", "螣蛇", "白虎", "玄武"];
  const LINE_LABELS = ["初爻", "二爻", "三爻", "四爻", "五爻", "上爻"];
  const RELATIONS = ["兄弟", "父母", "官鬼", "妻财", "子孙"];

  const TRIGRAM_NAME = {
    "111": "乾",
    "110": "兑",
    "101": "离",
    "100": "震",
    "011": "巽",
    "010": "坎",
    "001": "艮",
    "000": "坤",
  };

  const TRIGRAM_BITS = Object.fromEntries(Object.entries(TRIGRAM_NAME).map(([bits, name]) => [name, bits]));
  const PALACE_WUXING = {
    乾: "金",
    兑: "金",
    离: "火",
    震: "木",
    巽: "木",
    坎: "水",
    艮: "土",
    坤: "土",
  };

  const BRANCH_WUXING = {
    子: "水",
    丑: "土",
    寅: "木",
    卯: "木",
    辰: "土",
    巳: "火",
    午: "火",
    未: "土",
    申: "金",
    酉: "金",
    戌: "土",
    亥: "水",
  };

  const WUXING_GENERATES = { 木: "火", 火: "土", 土: "金", 金: "水", 水: "木" };
  const WUXING_CONTROLS = { 木: "土", 土: "水", 水: "火", 火: "金", 金: "木" };
  const LIUHE_PAIRS = new Set(["子丑", "丑子", "寅亥", "亥寅", "卯戌", "戌卯", "辰酉", "酉辰", "巳申", "申巳", "午未", "未午"]);
  const TRANSFORMATION_ADVANCE = new Set(["亥子", "寅卯", "巳午", "申酉", "丑辰", "辰未", "未戌", "戌丑"]);
  const TRANSFORMATION_RETREAT = new Set(["子亥", "卯寅", "午巳", "酉申", "辰丑", "未辰", "戌未", "丑戌"]);

  const FOCUS_RULES = {
    self: { label: "自己 / 自身状态", mode: "position", position: "世" },
    other_party: { label: "对方 / 合作关系", mode: "position", position: "应" },
    career: { label: "事业职位 / 功名", mode: "relation", relation: "官鬼" },
    wealth: { label: "收入 / 交易 / 财物", mode: "relation", relation: "妻财" },
    documents: { label: "父母长辈 / 合同文书 / 房屋", mode: "relation", relation: "父母" },
    children: { label: "子女晚辈 / 成果 / 医药", mode: "relation", relation: "子孙" },
    peers: { label: "同辈朋友 / 竞争", mode: "relation", relation: "兄弟" },
    male_partner: { label: "男性伴侣", mode: "relation", relation: "官鬼" },
    female_partner: { label: "女性伴侣", mode: "relation", relation: "妻财" },
  };

  const FOCUS_ALIASES = {
    自己: "self", 自身: "self", 世爻: "self", 健康: "self",
    对方: "other_party", 合作: "other_party", 应爻: "other_party", 关系: "other_party",
    事业: "career", 职位: "career", 功名: "career", 考试: "career", 官鬼: "career",
    财运: "wealth", 收入: "wealth", 财物: "wealth", 交易: "wealth", 寻物: "wealth", 妻财: "wealth",
    父母: "documents", 长辈: "documents", 合同: "documents", 文书: "documents", 房屋: "documents",
    子女: "children", 晚辈: "children", 成果: "children", 医药: "children", 子孙: "children",
    朋友: "peers", 同辈: "peers", 竞争: "peers", 兄弟: "peers",
    男性伴侣: "male_partner", 男友: "male_partner", 丈夫: "male_partner",
    女性伴侣: "female_partner", 女友: "female_partner", 妻子: "female_partner",
  };

  const NAJIA = {
    乾: { innerStem: "甲", innerBranches: "子寅辰", outerStem: "壬", outerBranches: "午申戌" },
    坎: { innerStem: "戊", innerBranches: "寅辰午", outerStem: "戊", outerBranches: "申戌子" },
    艮: { innerStem: "丙", innerBranches: "辰午申", outerStem: "丙", outerBranches: "戌子寅" },
    震: { innerStem: "庚", innerBranches: "子寅辰", outerStem: "庚", outerBranches: "午申戌" },
    巽: { innerStem: "辛", innerBranches: "丑亥酉", outerStem: "辛", outerBranches: "未巳卯" },
    离: { innerStem: "己", innerBranches: "卯丑亥", outerStem: "己", outerBranches: "酉未巳" },
    坤: { innerStem: "乙", innerBranches: "未巳卯", outerStem: "癸", outerBranches: "丑亥酉" },
    兑: { innerStem: "丁", innerBranches: "巳卯丑", outerStem: "丁", outerBranches: "亥酉未" },
  };

  // 键为自下而上的六位阴阳值，1=阳、0=阴。
  const HEXAGRAM_NAMES = {
    "111111": "乾为天", "011111": "天风姤", "001111": "天山遁", "000111": "天地否",
    "000011": "风地观", "000001": "山地剥", "000101": "火地晋", "111101": "火天大有",
    "110110": "兑为泽", "010110": "泽水困", "000110": "泽地萃", "001110": "泽山咸",
    "001010": "水山蹇", "001000": "地山谦", "001100": "雷山小过", "110100": "雷泽归妹",
    "101101": "离为火", "001101": "火山旅", "011101": "火风鼎", "010101": "火水未济",
    "010001": "山水蒙", "010011": "风水涣", "010111": "天水讼", "101111": "天火同人",
    "100100": "震为雷", "000100": "雷地豫", "010100": "雷水解", "011100": "雷风恒",
    "011000": "地风升", "011010": "水风井", "011110": "泽风大过", "100110": "泽雷随",
    "011011": "巽为风", "111011": "风天小畜", "101011": "风火家人", "100011": "风雷益",
    "100111": "天雷无妄", "100101": "火雷噬嗑", "100001": "山雷颐", "011001": "山风蛊",
    "010010": "坎为水", "110010": "水泽节", "100010": "水雷屯", "101010": "水火既济",
    "101110": "泽火革", "101100": "雷火丰", "101000": "地火明夷", "010000": "地水师",
    "001001": "艮为山", "101001": "山火贲", "111001": "山天大畜", "110001": "山泽损",
    "110101": "火泽睽", "110111": "天泽履", "110011": "风泽中孚", "001011": "风山渐",
    "000000": "坤为地", "100000": "地雷复", "110000": "地泽临", "111000": "地天泰",
    "111100": "雷天大壮", "111110": "泽天夬", "111010": "水天需", "000010": "水地比",
  };

  const HEXAGRAM_IMAGES = {
    "乾为天": "刚健中正，自强不息；宜进取，亦需戒骄亢。",
    "天风姤": "一阴始生，不期而遇；宜辨来意，慎于轻信。",
    "天山遁": "阴长阳退，及时退避；宜守势蓄力。",
    "天地否": "天地不交，闭塞不通；宜静待转机。",
    "风地观": "风行地上，观仰瞻望；宜审势后动。",
    "山地剥": "阴盛剥阳，根基受损；宜守本止损。",
    "火地晋": "明出地上，循序上进；宜把握正当机会。",
    "火天大有": "火在天上，丰盛有得；宜持盈守成。",
    "兑为泽": "丽泽相连，和悦相通；宜诚恳沟通。",
    "泽水困": "泽中无水，处境受限；宜守正待时。",
    "泽地萃": "泽上于地，众力汇聚；宜聚合共识。",
    "泽山咸": "山上有泽，彼此感应；宜虚心相待。",
    "水山蹇": "山上有水，行路维艰；宜止险寻助。",
    "地山谦": "地中有山，谦而有光；宜收敛自持。",
    "雷山小过": "山上有雷，小事可行；大事宜慎。",
    "雷泽归妹": "泽上有雷，关系未正；宜慎始虑终。",
    "离为火": "明而相附，重在守正；宜辨明所依。",
    "火山旅": "山上有火，行旅无定；宜谨慎自持。",
    "火风鼎": "木上有火，革故鼎新；宜调和更新。",
    "火水未济": "火上水下，事犹未成；宜慎终如始。",
    "山水蒙": "山下出泉，蒙昧待启；宜求教明理。",
    "风水涣": "风行水上，涣散待聚；宜疏通隔阂。",
    "天水讼": "天水相违，争执渐生；宜止争慎始。",
    "天火同人": "天与火同，志同相协；宜公正合作。",
    "震为雷": "震动而醒，临惊不乱；宜整顿后行。",
    "雷地豫": "雷出地奋，顺势而动；宜防安逸过度。",
    "雷水解": "雷雨交作，险难渐解；宜及时解结。",
    "雷风恒": "雷风相与，恒久不息；宜守常持久。",
    "地风升": "木生地中，积小渐升；宜循序进取。",
    "水风井": "井养不穷，利于众人；宜修基础。",
    "泽风大过": "泽灭其木，负荷过重；宜调整支撑。",
    "泽雷随": "泽中有雷，随时而动；宜择善顺势。",
    "巽为风": "随风而入，柔顺渐进；宜反复申明。",
    "风天小畜": "小有蓄聚，力量未足；宜积累待时。",
    "风火家人": "风自火出，各安其位；宜先正其内。",
    "风雷益": "风雷相益，增益有时；宜利人利己。",
    "天雷无妄": "天下雷行，真实无妄；宜守正勿求奇。",
    "火雷噬嗑": "颐中有物，须断而通；宜明辨除障。",
    "山雷颐": "山下有雷，慎言节养；宜顾好根本。",
    "山风蛊": "山下有风，积弊待治；宜整饬更新。",
    "坎为水": "重险相叠，险中求行；宜持信谨慎。",
    "水泽节": "泽上有水，节制有度；宜设清楚边界。",
    "水雷屯": "云雷初动，起步多难；宜求助扎根。",
    "水火既济": "水火相济，事已初成；宜防成后生变。",
    "泽火革": "泽中有火，变革除旧；宜顺时而变。",
    "雷火丰": "雷电皆至，盛大光明；宜防盛极转衰。",
    "地火明夷": "明入地中，光明受伤；宜晦藏守正。",
    "地水师": "地中藏水，聚众而行；宜名正用人。",
    "艮为山": "重山并峙，止其所止；宜适可而止。",
    "山火贲": "山下有火，文饰有度；宜重质守朴。",
    "山天大畜": "天在山中，蓄德待时；宜厚积薄发。",
    "山泽损": "损下益上，先损后得；宜节制取舍。",
    "火泽睽": "火动泽乖，意见相背；宜求同存异。",
    "天泽履": "履险循礼，谨慎而行；宜守分有序。",
    "风泽中孚": "诚信在中，感通于外；宜以诚相待。",
    "风山渐": "木生山上，循序渐进；宜稳步推进。",
    "坤为地": "厚德载物，柔顺包容；宜守静承载。",
    "地雷复": "一阳来复，转机初生；宜养正徐行。",
    "地泽临": "泽上有地，居上临下；宜以德相待。",
    "地天泰": "天地交泰，上下相通；宜持盈守正。",
    "雷天大壮": "雷在天上，阳刚壮盛；宜戒躁勿恃强。",
    "泽天夬": "泽上于天，决而去弊；宜果断有备。",
    "水天需": "云上于天，待时而需；宜耐心准备。",
    "水地比": "地上有水，亲密相辅；宜诚信择伴。",
  };

  const PALACE_FLIPS = [
    { flips: [], shi: 6, type: "本宫" },
    { flips: [0], shi: 1, type: "一世" },
    { flips: [0, 1], shi: 2, type: "二世" },
    { flips: [0, 1, 2], shi: 3, type: "三世" },
    { flips: [0, 1, 2, 3], shi: 4, type: "四世" },
    { flips: [0, 1, 2, 3, 4], shi: 5, type: "五世" },
    { flips: [0, 1, 2, 4], shi: 4, type: "游魂" },
    { flips: [4], shi: 3, type: "归魂" },
  ];

  // 1900-2100 常用节气分钟表；基准为 1900-01-06 02:05 UTC。
  const SOLAR_TERM_MINUTES = [
    0, 21208, 42467, 63836, 85337, 107014, 128867, 150921,
    173149, 195551, 218072, 240693, 263343, 285989, 308563, 331033,
    353350, 375494, 397447, 419210, 440795, 462224, 483532, 504758,
  ];
  const SOLAR_TERM_NAMES = [
    "小寒", "大寒", "立春", "雨水", "惊蛰", "春分", "清明", "谷雨",
    "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑",
    "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至",
  ];
  const SOLAR_MONTH_BRANCH = { 0: 1, 2: 2, 4: 3, 6: 4, 8: 5, 10: 6, 12: 7, 14: 8, 16: 9, 18: 10, 20: 11, 22: 0 };

  function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
  }

  function buildPalaceTable() {
    const table = {};
    for (const palace of Object.keys(TRIGRAM_BITS)) {
      const base = `${TRIGRAM_BITS[palace]}${TRIGRAM_BITS[palace]}`;
      for (const item of PALACE_FLIPS) {
        const flipSet = new Set(item.flips);
        const bits = base.split("").map((bit, index) => flipSet.has(index) ? String(1 - Number(bit)) : bit).join("");
        table[bits] = { palace, type: item.type, shi: item.shi, ying: item.shi <= 3 ? item.shi + 3 : item.shi - 3 };
      }
    }
    return table;
  }

  const PALACE_TABLE = buildPalaceTable();

  function getRelation(lineWuxing, palaceWuxing) {
    if (lineWuxing === palaceWuxing) return "兄弟";
    if (WUXING_GENERATES[lineWuxing] === palaceWuxing) return "父母";
    if (WUXING_GENERATES[palaceWuxing] === lineWuxing) return "子孙";
    if (WUXING_CONTROLS[lineWuxing] === palaceWuxing) return "官鬼";
    return "妻财";
  }

  function getSixSpiritStart(dayStemIndex) {
    return [0, 0, 1, 1, 2, 3, 4, 4, 5, 5][dayStemIndex];
  }

  function areOppositeBranches(first, second) {
    const firstIndex = EARTHLY_BRANCHES.indexOf(first);
    const secondIndex = EARTHLY_BRANCHES.indexOf(second);
    return firstIndex >= 0 && secondIndex >= 0 && positiveModulo(firstIndex - secondIndex, 12) === 6;
  }

  function areCombinedBranches(first, second) {
    return LIUHE_PAIRS.has(`${first || ""}${second || ""}`);
  }

  function normalizeBits(bits) {
    const text = String(bits || "");
    if (!/^[01]{6}$/.test(text)) throw new Error(`六爻阴阳值必须是六位 0/1，收到 ${text || "空"}`);
    return text;
  }

  function normalizeLineValues(values) {
    if (!Array.isArray(values) || values.length !== 6) throw new Error("起卦需要恰好六个爻值");
    return values.map((value, index) => {
      const numeric = Number(value);
      if (![6, 7, 8, 9].includes(numeric)) throw new Error(`${LINE_LABELS[index]}必须是 6、7、8 或 9`);
      return numeric;
    });
  }

  function lineValuesToBits(values) {
    return normalizeLineValues(values).map((value) => value === 7 || value === 9 ? "1" : "0").join("");
  }

  function getChangedBits(values) {
    const normalized = normalizeLineValues(values);
    if (!normalized.some((value) => value === 6 || value === 9)) return null;
    return normalized.map((value) => value === 6 || value === 7 ? "1" : "0").join("");
  }

  function castChart(bits, dayStemIndex, options = {}) {
    const normalizedBits = normalizeBits(bits);
    const palaceInfo = PALACE_TABLE[normalizedBits];
    const lowerName = TRIGRAM_NAME[normalizedBits.slice(0, 3)];
    const upperName = TRIGRAM_NAME[normalizedBits.slice(3)];
    const lowerNajia = NAJIA[lowerName];
    const upperNajia = NAJIA[upperName];
    const palaceWuxing = options.relationPalaceWuxing || PALACE_WUXING[palaceInfo.palace];
    const shiPosition = Number.isInteger(options.shiPosition) ? options.shiPosition : palaceInfo.shi;
    const yingPosition = Number.isInteger(options.yingPosition) ? options.yingPosition : palaceInfo.ying;
    const stems = [
      lowerNajia.innerStem, lowerNajia.innerStem, lowerNajia.innerStem,
      upperNajia.outerStem, upperNajia.outerStem, upperNajia.outerStem,
    ];
    const branches = `${lowerNajia.innerBranches}${upperNajia.outerBranches}`.split("");
    const spiritStart = getSixSpiritStart(dayStemIndex);
    const voidSet = new Set(options.voidBranches || []);

    const lines = normalizedBits.split("").map((bit, index) => {
      const branch = branches[index];
      const wuxing = BRANCH_WUXING[branch];
      return {
        position: index + 1,
        label: LINE_LABELS[index],
        yinYang: bit === "1" ? "阳" : "阴",
        stem: stems[index],
        branch,
        najia: `${stems[index]}${branch}`,
        wuxing,
        relation: getRelation(wuxing, palaceWuxing),
        spirit: SIX_SPIRITS[(spiritStart + index) % 6],
        shiYing: index + 1 === shiPosition ? "世" : index + 1 === yingPosition ? "应" : "",
        isVoid: voidSet.has(branch),
        isMonthBreak: areOppositeBranches(branch, options.monthBranch),
        isDayClash: areOppositeBranches(branch, options.dayBranch),
        hiddenSpirits: [],
      };
    });

    return {
      bits: normalizedBits,
      name: HEXAGRAM_NAMES[normalizedBits],
      image: HEXAGRAM_IMAGES[HEXAGRAM_NAMES[normalizedBits]] || "",
      lowerTrigram: lowerName,
      upperTrigram: upperName,
      palace: palaceInfo.palace,
      palaceWuxing: PALACE_WUXING[palaceInfo.palace],
      type: palaceInfo.type,
      shiPosition,
      yingPosition,
      nativeShiPosition: palaceInfo.shi,
      nativeYingPosition: palaceInfo.ying,
      lines,
    };
  }

  function attachHiddenSpirits(chart, dayStemIndex, timeFacts) {
    const present = new Set(chart.lines.map((line) => line.relation));
    const baseBits = `${TRIGRAM_BITS[chart.palace]}${TRIGRAM_BITS[chart.palace]}`;
    const baseChart = castChart(baseBits, dayStemIndex, {
      relationPalaceWuxing: chart.palaceWuxing,
      voidBranches: timeFacts.voidBranches,
      monthBranch: timeFacts.month.branch,
      dayBranch: timeFacts.day.branch,
    });
    for (const relation of RELATIONS) {
      if (present.has(relation)) continue;
      const hidden = baseChart.lines.find((line) => line.relation === relation);
      if (!hidden) continue;
      chart.lines[hidden.position - 1].hiddenSpirits.push({
        relation: hidden.relation,
        najia: hidden.najia,
        wuxing: hidden.wuxing,
      });
    }
    return chart;
  }

  function julianDayNumber(year, month, day) {
    const a = Math.floor((14 - month) / 12);
    const adjustedYear = year + 4800 - a;
    const adjustedMonth = month + (12 * a) - 3;
    return day
      + Math.floor(((153 * adjustedMonth) + 2) / 5)
      + (365 * adjustedYear)
      + Math.floor(adjustedYear / 4)
      - Math.floor(adjustedYear / 100)
      + Math.floor(adjustedYear / 400)
      - 32045;
  }

  function addCivilDays(year, month, day, days) {
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }

  function getSolarTermUtc(year, termIndex) {
    // 相邻年份仅用于查找公历边界；用户输入范围仍由 normalizeDateParts 限制为 1900-2100。
    if (!Number.isInteger(year) || year < 1899 || year > 2101) throw new Error("当前版本支持 1900 至 2100 年的节气排盘");
    const epoch = Date.UTC(1900, 0, 6, 2, 5);
    const seed = epoch + (31556925974.7 * (year - 1900)) + (SOLAR_TERM_MINUTES[termIndex] * 60000);
    const targetLongitude = positiveModulo(285 + (termIndex * 15), 360);
    let low = seed - (3 * 86400000);
    let high = seed + (3 * 86400000);
    for (let index = 0; index < 48; index += 1) {
      const middle = (low + high) / 2;
      const delta = positiveModulo(getApparentSolarLongitude(middle) - targetLongitude + 180, 360) - 180;
      if (delta < 0) low = middle;
      else high = middle;
    }
    return Math.round((low + high) / 2);
  }

  function getApparentSolarLongitude(instantMs) {
    const julianDate = (instantMs / 86400000) + 2440587.5;
    const century = (julianDate - 2451545.0) / 36525;
    const meanLongitude = positiveModulo(280.46646 + (century * (36000.76983 + (century * 0.0003032))), 360);
    const meanAnomaly = (357.52911 + (century * (35999.05029 - (0.0001537 * century)))) * Math.PI / 180;
    const equation =
      (Math.sin(meanAnomaly) * (1.914602 - (century * (0.004817 + (0.000014 * century)))))
      + (Math.sin(2 * meanAnomaly) * (0.019993 - (0.000101 * century)))
      + (Math.sin(3 * meanAnomaly) * 0.000289);
    const omega = (125.04 - (1934.136 * century)) * Math.PI / 180;
    return positiveModulo(meanLongitude + equation - 0.00569 - (0.00478 * Math.sin(omega)), 360);
  }

  function resolveMonthBoundary(instantMs, civilYear) {
    const boundaries = [];
    for (const year of [civilYear - 1, civilYear, civilYear + 1]) {
      for (const termIndex of Object.keys(SOLAR_MONTH_BRANCH).map(Number)) {
        boundaries.push({
          instantMs: getSolarTermUtc(year, termIndex),
          termIndex,
          termName: SOLAR_TERM_NAMES[termIndex],
          branchIndex: SOLAR_MONTH_BRANCH[termIndex],
          year,
        });
      }
    }
    boundaries.sort((a, b) => a.instantMs - b.instantMs);
    const active = boundaries.filter((item) => item.instantMs <= instantMs).at(-1);
    const nearest = boundaries.reduce((best, item) => {
      if (!best) return item;
      return Math.abs(item.instantMs - instantMs) < Math.abs(best.instantMs - instantMs) ? item : best;
    }, null);
    return {
      ...active,
      nearestTermName: nearest?.termName || active?.termName || "",
      nearestInstantMs: nearest?.instantMs || active?.instantMs || 0,
      nearestDistanceMinutes: nearest ? Math.abs(nearest.instantMs - instantMs) / 60000 : Infinity,
    };
  }

  function normalizeDateParts(input) {
    if (input instanceof Date) {
      if (Number.isNaN(input.getTime())) throw new Error("起卦时间无效");
      return {
        year: input.getFullYear(),
        month: input.getMonth() + 1,
        day: input.getDate(),
        hour: input.getHours(),
        minute: input.getMinutes(),
        tzOffsetMinutes: -input.getTimezoneOffset(),
        instantMs: input.getTime(),
      };
    }
    const value = input || {};
    const parts = {
      year: Number(value.year),
      month: Number(value.month),
      day: Number(value.day),
      hour: Number(value.hour || 0),
      minute: Number(value.minute || 0),
      tzOffsetMinutes: Number.isFinite(Number(value.tzOffsetMinutes)) ? Number(value.tzOffsetMinutes) : 480,
    };
    const wallClockUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    parts.instantMs = Number.isFinite(Number(value.instantMs))
      ? Number(value.instantMs)
      : wallClockUtc - (parts.tzOffsetMinutes * 60000);
    const normalizedCivilDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    const isValidCivilDate = normalizedCivilDate.getUTCFullYear() === parts.year
      && normalizedCivilDate.getUTCMonth() + 1 === parts.month
      && normalizedCivilDate.getUTCDate() === parts.day;
    if (!Number.isFinite(parts.instantMs) || parts.year < 1900 || parts.year > 2100 || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31 || parts.hour < 0 || parts.hour > 23 || parts.minute < 0 || parts.minute > 59 || !isValidCivilDate) {
      throw new Error("起卦时间无效或超出 1900 至 2100 年范围");
    }
    return parts;
  }

  function pillarFromCycleIndex(index) {
    const normalized = positiveModulo(index, 60);
    return {
      stemIndex: normalized % 10,
      branchIndex: normalized % 12,
      stem: HEAVENLY_STEMS[normalized % 10],
      branch: EARTHLY_BRANCHES[normalized % 12],
      text: `${HEAVENLY_STEMS[normalized % 10]}${EARTHLY_BRANCHES[normalized % 12]}`,
    };
  }

  function computeFourPillars(input) {
    const parts = normalizeDateParts(input);
    const effectiveDay = parts.hour >= 23 ? addCivilDays(parts.year, parts.month, parts.day, 1) : parts;
    const dayCycleIndex = positiveModulo(julianDayNumber(effectiveDay.year, effectiveDay.month, effectiveDay.day) + 49, 60);
    const dayPillar = pillarFromCycleIndex(dayCycleIndex);

    const lichunMs = getSolarTermUtc(parts.year, 2);
    const ganzhiYear = parts.instantMs >= lichunMs ? parts.year : parts.year - 1;
    const yearPillar = pillarFromCycleIndex(ganzhiYear - 4);
    const monthBoundary = resolveMonthBoundary(parts.instantMs, parts.year);
    const yinMonthStemIndex = positiveModulo(((yearPillar.stemIndex % 5) * 2) + 2, 10);
    const monthOffsetFromYin = positiveModulo(monthBoundary.branchIndex - 2, 12);
    const monthStemIndex = positiveModulo(yinMonthStemIndex + monthOffsetFromYin, 10);
    const monthPillar = {
      stemIndex: monthStemIndex,
      branchIndex: monthBoundary.branchIndex,
      stem: HEAVENLY_STEMS[monthStemIndex],
      branch: EARTHLY_BRANCHES[monthBoundary.branchIndex],
      text: `${HEAVENLY_STEMS[monthStemIndex]}${EARTHLY_BRANCHES[monthBoundary.branchIndex]}`,
    };

    const hourBranchIndex = Math.floor((parts.hour + 1) / 2) % 12;
    const hourStemIndex = positiveModulo(((dayPillar.stemIndex % 5) * 2) + hourBranchIndex, 10);
    const hourPillar = {
      stemIndex: hourStemIndex,
      branchIndex: hourBranchIndex,
      stem: HEAVENLY_STEMS[hourStemIndex],
      branch: EARTHLY_BRANCHES[hourBranchIndex],
      text: `${HEAVENLY_STEMS[hourStemIndex]}${EARTHLY_BRANCHES[hourBranchIndex]}`,
    };

    const xunStartBranch = positiveModulo(dayPillar.branchIndex - dayPillar.stemIndex, 12);
    const voidBranches = [
      EARTHLY_BRANCHES[positiveModulo(xunStartBranch - 2, 12)],
      EARTHLY_BRANCHES[positiveModulo(xunStartBranch - 1, 12)],
    ];

    return {
      year: yearPillar,
      month: monthPillar,
      day: dayPillar,
      hour: hourPillar,
      voidBranches,
      monthBoundary: {
        name: monthBoundary.termName,
        instant: new Date(monthBoundary.instantMs).toISOString(),
        nearestName: monthBoundary.nearestTermName,
        nearestInstant: new Date(monthBoundary.nearestInstantMs).toISOString(),
        nearestDistanceMinutes: Math.round(monthBoundary.nearestDistanceMinutes * 10) / 10,
        nearTransition: monthBoundary.nearestDistanceMinutes <= 15,
      },
      dayBoundary: "23:00 子初换日",
      calendarWarnings: monthBoundary.nearestDistanceMinutes <= 15
        ? [`当前时刻距离${monthBoundary.nearestTermName}交界不足 15 分钟，年柱或月柱可能因历法精度与流派口径不同而变化。`]
        : [],
      input: parts,
    };
  }

  function normalizeFocus(value) {
    const text = String(value || "").trim();
    if (FOCUS_RULES[text]) return text;
    return FOCUS_ALIASES[text] || "";
  }

  function getMonthState(lineWuxing, monthWuxing) {
    if (lineWuxing === monthWuxing) return "旺";
    if (WUXING_GENERATES[monthWuxing] === lineWuxing) return "相";
    if (WUXING_GENERATES[lineWuxing] === monthWuxing) return "休";
    if (WUXING_CONTROLS[lineWuxing] === monthWuxing) return "囚";
    return "死";
  }

  function getElementInteraction(sourceWuxing, targetWuxing, sourceLabel) {
    if (sourceWuxing === targetWuxing) return `${sourceLabel}比和`;
    if (WUXING_GENERATES[sourceWuxing] === targetWuxing) return `${sourceLabel}生爻`;
    if (WUXING_GENERATES[targetWuxing] === sourceWuxing) return `爻生${sourceLabel}`;
    if (WUXING_CONTROLS[sourceWuxing] === targetWuxing) return `${sourceLabel}克爻`;
    return `爻克${sourceLabel}`;
  }

  function buildStrengthFacts(wuxing, branch, time) {
    const monthWuxing = BRANCH_WUXING[time.month.branch];
    const dayWuxing = BRANCH_WUXING[time.day.branch];
    const monthState = getMonthState(wuxing, monthWuxing);
    return {
      monthState,
      monthRelation: getElementInteraction(monthWuxing, wuxing, "月"),
      dayRelation: getElementInteraction(dayWuxing, wuxing, "日"),
      supportedByMonth: monthState === "旺" || monthState === "相",
      supportedByDay: dayWuxing === wuxing || WUXING_GENERATES[dayWuxing] === wuxing,
      isMonthCombined: areCombinedBranches(branch, time.month.branch),
      isDayCombined: areCombinedBranches(branch, time.day.branch),
    };
  }

  function getTransformationRelation(primaryLine, changedLine) {
    if (!primaryLine || !changedLine) return null;
    const pair = `${primaryLine.branch}${changedLine.branch}`;
    if (primaryLine.wuxing === changedLine.wuxing) {
      if (TRANSFORMATION_ADVANCE.has(pair)) return "化进";
      if (TRANSFORMATION_RETREAT.has(pair)) return "化退";
      return primaryLine.branch === changedLine.branch ? "伏吟" : "比和";
    }
    if (WUXING_GENERATES[changedLine.wuxing] === primaryLine.wuxing) return "回头生";
    if (WUXING_CONTROLS[changedLine.wuxing] === primaryLine.wuxing) return "回头克";
    return null;
  }

  function decorateLineFacts(primary, changed, time) {
    primary.lines = primary.lines.map((line) => {
      const strength = buildStrengthFacts(line.wuxing, line.branch, time);
      const changedLine = line.isMoving && changed ? changed.lines[line.position - 1] : null;
      const transformation = changedLine ? {
        position: line.position,
        changedNajia: changedLine.najia,
        changedBranch: changedLine.branch,
        changedWuxing: changedLine.wuxing,
        relation: getTransformationRelation(line, changedLine),
        isOpposite: areOppositeBranches(line.branch, changedLine.branch),
        isSameBranch: line.branch === changedLine.branch,
      } : null;
      const hiddenSpirits = line.hiddenSpirits.map((hidden) => {
        const branch = hidden.najia.slice(-1);
        return {
          ...hidden,
          branch,
          strength: buildStrengthFacts(hidden.wuxing, branch, time),
          flyingRelation: line.wuxing === hidden.wuxing
            ? "飞伏比和"
            : WUXING_GENERATES[line.wuxing] === hidden.wuxing
              ? "飞来生伏"
              : WUXING_CONTROLS[line.wuxing] === hidden.wuxing
                ? "飞来克伏"
                : WUXING_GENERATES[hidden.wuxing] === line.wuxing
                  ? "伏来生飞"
                  : "伏来克飞",
        };
      });
      return {
        ...line,
        strength,
        hiddenSpirits,
        isMonthCombined: strength.isMonthCombined,
        isDayCombined: strength.isDayCombined,
        isDarkMovingCandidate: Boolean(
          line.isDayClash
            && !line.isMoving
            && !line.isVoid
            && !line.isMonthBreak
            && (strength.supportedByMonth || strength.supportedByDay)
        ),
        transformation,
      };
    });
    return primary;
  }

  function lineCandidate(line, extra = {}) {
    return {
      position: line.position,
      label: line.label,
      shiYing: line.shiYing || "",
      relation: line.relation,
      najia: line.najia,
      wuxing: line.wuxing,
      hidden: false,
      strength: line.strength,
      ...extra,
    };
  }

  function resolveUseSpirit(primary, focusKey) {
    const rule = FOCUS_RULES[focusKey];
    if (!rule) {
      return {
        resolved: false,
        mode: "unresolved",
        focus: "",
        focusLabel: "未指定判断重点",
        target: "",
        candidates: [],
        chosen: null,
        multiple: false,
        hidden: false,
        basis: "未明确所问对象时不自动猜测用神",
      };
    }

    let candidates = [];
    let target = "";
    if (rule.mode === "position") {
      target = rule.position;
      const position = rule.position === "世" ? primary.shiPosition : primary.yingPosition;
      const line = primary.lines[position - 1];
      if (line) candidates = [lineCandidate(line)];
    } else {
      target = rule.relation;
      candidates = primary.lines.filter((line) => line.relation === rule.relation).map((line) => lineCandidate(line));
      if (!candidates.length) {
        candidates = primary.lines.flatMap((hostLine) => hostLine.hiddenSpirits
          .filter((hidden) => hidden.relation === rule.relation)
          .map((hidden) => ({
            position: null,
            hostPosition: hostLine.position,
            label: `伏于${hostLine.label}`,
            shiYing: "",
            relation: hidden.relation,
            najia: hidden.najia,
            wuxing: hidden.wuxing,
            hidden: true,
            strength: hidden.strength,
            flyingRelation: hidden.flyingRelation,
          })));
      }
    }

    return {
      resolved: Boolean(candidates.length),
      mode: rule.mode,
      focus: focusKey,
      focusLabel: rule.label,
      target,
      candidates,
      chosen: candidates.length === 1 ? candidates[0] : null,
      multiple: candidates.length > 1,
      hidden: candidates.length > 0 && candidates.every((item) => item.hidden),
      basis: rule.mode === "position" ? `${rule.position}爻为纲` : `${rule.relation}为用神`,
      requiresComparison: candidates.length > 1,
    };
  }

  function relationForGeneratedRole(wuxing, palaceWuxing) {
    return getRelation(wuxing, palaceWuxing);
  }

  function deriveSupportingRelations(useSpirit, palaceWuxing) {
    const representative = useSpirit.chosen || useSpirit.candidates[0];
    const useWuxing = representative?.wuxing;
    if (!useWuxing) return null;
    const originalWuxing = Object.keys(WUXING_GENERATES).find((item) => WUXING_GENERATES[item] === useWuxing);
    const opposingWuxing = Object.keys(WUXING_CONTROLS).find((item) => WUXING_CONTROLS[item] === useWuxing);
    const enemyWuxing = Object.keys(WUXING_GENERATES).find((item) => WUXING_GENERATES[item] === opposingWuxing);
    return {
      useWuxing,
      originalSpirit: { wuxing: originalWuxing, relation: relationForGeneratedRole(originalWuxing, palaceWuxing) },
      opposingSpirit: { wuxing: opposingWuxing, relation: relationForGeneratedRole(opposingWuxing, palaceWuxing) },
      enemySpirit: { wuxing: enemyWuxing, relation: relationForGeneratedRole(enemyWuxing, palaceWuxing) },
    };
  }

  function buildHexagramRelations(primary) {
    const branches = primary.lines.map((line) => line.branch);
    const movingBranches = new Set(primary.lines.filter((line) => line.isMoving).map((line) => line.branch));
    const threeHarmonyRules = [
      { wuxing: "水", branches: ["申", "子", "辰"], center: "子" },
      { wuxing: "木", branches: ["亥", "卯", "未"], center: "卯" },
      { wuxing: "火", branches: ["寅", "午", "戌"], center: "午" },
      { wuxing: "金", branches: ["巳", "酉", "丑"], center: "酉" },
    ];
    const present = new Set(branches);
    const threeHarmony = threeHarmonyRules.flatMap((rule) => {
      const matched = rule.branches.filter((branch) => present.has(branch));
      if (matched.length === 3) return [{ wuxing: rule.wuxing, state: "全局", containsMoving: matched.some((branch) => movingBranches.has(branch)) }];
      if (matched.length === 2 && matched.includes(rule.center)) return [{ wuxing: rule.wuxing, state: "半合", containsMoving: matched.some((branch) => movingBranches.has(branch)) }];
      return [];
    });
    return {
      sixHarmony: [0, 1, 2].every((index) => areCombinedBranches(branches[index], branches[index + 3])),
      threeHarmony,
    };
  }

  function compactCandidate(candidate) {
    if (!candidate) return "无";
    const position = candidate.hidden ? candidate.label : `${candidate.label}${candidate.shiYing ? `(${candidate.shiYing})` : ""}`;
    return `${position} ${candidate.relation}${candidate.najia}${candidate.wuxing} ${candidate.strength?.monthState || ""}`.trim();
  }

  function buildFactCatalog(reading, useSpirit, supportingRelations, hexagramRelations) {
    const moving = reading.primary.lines.filter((line) => line.isMoving);
    const lineFacts = reading.primary.lines.map((line) => `${line.label}:${line.relation}${line.najia}${line.wuxing}/${line.strength.monthState}${line.isVoid ? "/空" : ""}${line.isMonthBreak ? "/月破" : ""}${line.isDayClash ? "/日冲" : ""}`).join("；");
    const transformations = moving.map((line) => `${line.label}:${line.najia}→${line.transformation?.changedNajia || ""}${line.transformation?.relation ? `/${line.transformation.relation}` : ""}`).join("；") || "无动爻";
    return [
      { id: "本卦.卦名", value: reading.primary.name },
      { id: "本卦.卦宫", value: `${reading.primary.palace}宫·${reading.primary.palaceWuxing}·${reading.primary.type}` },
      { id: "本卦.世应", value: `世${reading.primary.shiPosition}爻，应${reading.primary.yingPosition}爻` },
      { id: "本卦.六亲纳甲", value: lineFacts },
      { id: "本卦.动爻", value: moving.length ? moving.map((line) => `${line.label}${line.movingType}`).join("、") : "无动爻" },
      ...(reading.changed ? [{ id: "变卦.卦名", value: reading.changed.name }, { id: "变卦.变爻关系", value: transformations }] : []),
      { id: "四柱.年月日时", value: `${reading.time.year.text} ${reading.time.month.text} ${reading.time.day.text} ${reading.time.hour.text}` },
      { id: "四柱.旬空", value: reading.time.voidBranches.join("") },
      { id: "四柱.月建日辰", value: `月建${reading.time.month.branch}，日辰${reading.time.day.branch}` },
      { id: "取用.判断重点", value: useSpirit.focusLabel },
      { id: "取用.用神候选", value: useSpirit.candidates.length ? `${useSpirit.target}：${useSpirit.candidates.map(compactCandidate).join("；")}` : "未解析，不自动取用" },
      { id: "取用.原神忌神仇神", value: supportingRelations ? `原神${supportingRelations.originalSpirit.relation}，忌神${supportingRelations.opposingSpirit.relation}，仇神${supportingRelations.enemySpirit.relation}` : "未解析" },
      { id: "旺衰.逐爻", value: lineFacts },
      { id: "关系.日月合冲", value: reading.primary.lines.map((line) => `${line.label}:${line.isMonthCombined ? "月合" : ""}${line.isDayCombined ? "日合" : ""}${line.isMonthBreak ? "月破" : ""}${line.isDayClash ? "日冲" : ""}${line.isDarkMovingCandidate ? "暗动候选" : ""}`).filter((item) => !item.endsWith(":")).join("；") || "无显著合冲" },
      { id: "关系.动变", value: transformations },
      { id: "关系.卦局", value: `六合:${hexagramRelations.sixHarmony ? "是" : "否"}；三合:${hexagramRelations.threeHarmony.map((item) => `${item.wuxing}${item.state}`).join("、") || "无"}` },
    ];
  }

  function buildDeterministicAnalysis(reading) {
    const focusKey = normalizeFocus(reading.focus);
    const useSpirit = resolveUseSpirit(reading.primary, focusKey);
    const supportingRelations = deriveSupportingRelations(useSpirit, reading.primary.palaceWuxing);
    const hexagramRelations = buildHexagramRelations(reading.primary);
    const warnings = [];
    if (!focusKey) warnings.push("未明确判断重点，本地内核没有自动猜测用神。");
    if (useSpirit.multiple) warnings.push("用神两现，保留全部候选并要求逐项比较，不自动舍弃其中一爻。");
    if (Array.isArray(reading.time.calendarWarnings)) warnings.push(...reading.time.calendarWarnings);
    const analysis = {
      schema: "guanshi-liuyao-analysis-v1",
      focus: focusKey,
      focusLabel: useSpirit.focusLabel,
      useSpirit,
      supportingRelations,
      hexagramRelations,
      warnings,
      ruleNotes: ["旺衰按月建五行计算", "暗动仅标记为候选，需结合旺衰", "变爻六亲与世应沿用本卦判断口径"],
      factCatalog: [],
    };
    analysis.factCatalog = buildFactCatalog(reading, useSpirit, supportingRelations, hexagramRelations);
    return analysis;
  }

  function randomCoin(randomSource) {
    if (typeof randomSource === "function") return Number(randomSource()) & 1;
    const cryptoRef = globalScope.crypto;
    if (!cryptoRef || typeof cryptoRef.getRandomValues !== "function") throw new Error("当前环境不支持安全随机起卦");
    const bytes = new Uint8Array(1);
    cryptoRef.getRandomValues(bytes);
    return bytes[0] & 1;
  }

  function tossLine(randomSource) {
    const coins = [randomCoin(randomSource), randomCoin(randomSource), randomCoin(randomSource)];
    const backs = coins.reduce((sum, value) => sum + value, 0);
    const value = [6, 7, 8, 9][backs];
    return { coins, backs, value };
  }

  function tossHexagram(randomSource) {
    const tosses = Array.from({ length: 6 }, () => tossLine(randomSource));
    return { lineValues: tosses.map((item) => item.value), tosses };
  }

  function buildReading(input = {}) {
    const lineValues = normalizeLineValues(input.lineValues);
    const time = computeFourPillars(input.dateTime);
    const focus = normalizeFocus(input.focus);
    const primaryBits = lineValuesToBits(lineValues);
    const changedBits = getChangedBits(lineValues);
    const primary = attachHiddenSpirits(castChart(primaryBits, time.day.stemIndex, {
      voidBranches: time.voidBranches,
      monthBranch: time.month.branch,
      dayBranch: time.day.branch,
    }), time.day.stemIndex, time);
    const changed = changedBits ? castChart(changedBits, time.day.stemIndex, {
      relationPalaceWuxing: primary.palaceWuxing,
      shiPosition: primary.shiPosition,
      yingPosition: primary.yingPosition,
      voidBranches: time.voidBranches,
      monthBranch: time.month.branch,
      dayBranch: time.day.branch,
    }) : null;

    if (changed) {
      changed.nativeStructure = {
        palace: changed.palace,
        palaceWuxing: changed.palaceWuxing,
        type: changed.type,
        shiPosition: changed.nativeShiPosition,
        yingPosition: changed.nativeYingPosition,
      };
      changed.interpretationBasis = {
        palace: primary.palace,
        palaceWuxing: primary.palaceWuxing,
        shiPosition: primary.shiPosition,
        yingPosition: primary.yingPosition,
        note: "变爻六亲与世应沿用本卦口径",
      };
    }

    primary.lines = primary.lines.map((line, index) => ({
      ...line,
      value: lineValues[index],
      isMoving: lineValues[index] === 6 || lineValues[index] === 9,
      movingType: lineValues[index] === 6 ? "老阴" : lineValues[index] === 9 ? "老阳" : "",
      changedLine: changed && (lineValues[index] === 6 || lineValues[index] === 9) ? changed.lines[index] : null,
    }));
    decorateLineFacts(primary, changed, time);

    const createdAt = input.createdAt || new Date().toISOString();
    const reading = {
      schema: READING_SCHEMA,
      id: String(input.id || `liuyao-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      question: String(input.question || "").trim(),
      category: String(input.category || "其他").trim() || "其他",
      focus,
      dateTime: String(input.dateTimeText || createdAt),
      timezone: String(input.timezone || "本地时区"),
      createdAt,
      method: "三钱法",
      school: "京房八宫纳甲",
      lineValues,
      tosses: Array.isArray(input.tosses) ? input.tosses : [],
      time,
      primary,
      changed,
      movingPositions: primary.lines.filter((line) => line.isMoving).map((line) => line.position),
    };
    reading.analysis = buildDeterministicAnalysis(reading);
    return reading;
  }

  const api = {
    READING_SCHEMA,
    HEAVENLY_STEMS,
    EARTHLY_BRANCHES,
    SIX_SPIRITS,
    LINE_LABELS,
    RELATIONS,
    FOCUS_RULES,
    TRIGRAM_NAME,
    PALACE_TABLE,
    HEXAGRAM_NAMES,
    normalizeLineValues,
    lineValuesToBits,
    getChangedBits,
    castChart,
    computeFourPillars,
    normalizeFocus,
    tossLine,
    tossHexagram,
    buildReading,
    getSolarTermUtc,
  };

  globalScope.TimeQualityLiuyaoEngineModule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
