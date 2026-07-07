import { describe, expect, it } from "vitest";
import { parseTimetable } from "../src/parsers/timetable.js";
import { parseTaskList } from "../src/parsers/taskList.js";
import { parseCourse } from "../src/parsers/course.js";
import { parseSearchResults } from "../src/parsers/search.js";
import { parseSyllabus } from "../src/parsers/syllabus.js";
import { looksLikeLoginPage } from "../src/browser/client.js";

/**
 * 合成フィクスチャによるパーサの基本動作テスト。
 * 実 UTOL の HTML 構造は技術検証スパイクで取得・匿名化したフィクスチャに差し替え、
 * セレクタを精緻化する。
 */

describe("parseTimetable", () => {
  // 実 HTML 構造: .timetable-course-top-btn[id=idnumber] + 隣接 .div-table-cell-detail
  it("グリッドのコースボタンから idnumber/名称/教員/曜日を抽出する", () => {
    const html = `
      <div id="selectTimetable"></div>
      <div class="div-table-cell 4-yobicol">
        <div class="timetable-course-top-btn clearfix divTableCellHeader" id="2026_3747_3747-066_01">
          <a class="bold-txt break reset_a" href="javascript:void(0)">ネットワークコンピューティング</a>
        </div>
        <div class="div-table-cell-detail"><div><span>中山 雅哉</span><span>, 関谷 勇司</span></div></div>
      </div>
      <div class="timetable-course-top-btn" id="2026_A0_A092616_02">
        <a class="bold-txt reset_a" href="javascript:void(0)">人を対象とする研究の倫理講習会</a>
      </div>
      <div class="div-table-cell-detail"><span>三浦 竜一</span></div>`;
    const courses = parseTimetable(html);
    expect(courses).toHaveLength(2);
    const net = courses.find((c) => c.idnumber === "2026_3747_3747-066_01")!;
    expect(net.name).toBe("ネットワークコンピューティング");
    expect(net.teachers).toEqual(["中山 雅哉", "関谷 勇司"]);
    expect(net.dayPeriod?.day).toBe("木");
    expect(net.year).toBe(2026);
    expect(net.url).toContain("/lms/course?idnumber=2026_3747_3747-066_01");
  });
});

describe("parseTaskList", () => {
  // 実 HTML 構造: .tasklist-title > a[href], 兄弟 .tasklist-deadline .deadline / .tasklist-status / .tasklist-course
  it("課題行から締切(24:00→翌日)・種別・提出状況を抽出する", () => {
    const html = `
      <div class="tasklist-row">
        <div class="tasklist-course break course">最先端デジタル技術トレンド</div>
        <div class="tasklist-title answer-test break">
          <a class="link-txt title" href="/lms/course/report/submission?idnumber=2026_4884_4840-1058_01&reportId=239472">
            <span>第12回（7/3）</span></a>
        </div>
        <div class="tasklist-deadline break">
          <span>2026/07/03 19:00</span><span>～</span><span class="deadline">2026/07/10 24:00</span>
        </div>
        <div class="tasklist-status break"><a data-idnumber="2026_4884_4840-1058_01">未提出</a></div>
      </div>`;
    const tasks = parseTaskList(html);
    expect(tasks).toHaveLength(1);
    const t = tasks[0]!;
    expect(t.title).toBe("第12回（7/3）");
    expect(t.dueAt).toBe("2026-07-11T00:00:00+09:00"); // 24:00 → 翌日 00:00
    expect(t.kind).toBe("assignment");
    expect(t.submitted).toBe(false);
    expect(t.courseIdnumber).toBe("2026_4884_4840-1058_01");
    expect(t.courseName).toBe("最先端デジタル技術トレンド");
    expect(t.id).toBe("239472");
  });

  it("テスト・アンケートを href から判別する", () => {
    const html = `
      <div><div class="tasklist-title"><a href="/lms/course/examination/taketop?idnumber=2026_A0_A092616_02&examinationId=59494"><span>確認テスト</span></a></div>
      <div class="tasklist-deadline"><span class="deadline">2027/04/01 00:00</span></div></div>
      <div><div class="tasklist-title"><a href="/lms/course/surveys/take?idnumber=2026_A0_A092604_02&surveyId=76239"><span>アンケート</span></a></div></div>`;
    const tasks = parseTaskList(html);
    expect(tasks.find((t) => t.title === "確認テスト")?.kind).toBe("test");
    expect(tasks.find((t) => t.title === "アンケート")?.kind).toBe("questionnaire");
  });
});

describe("parseCourse", () => {
  // 実 HTML 構造: #materialList .course-result-list.materialCss / #reportList a.course-view-report-name
  it("教材と課題を抽出する", () => {
    const html = `
      <title>ネットワークコンピューティング | コーストップ</title>
      <div id="materialList">
        <div id="material1049686" class="course-result-list materialCss">
          <div class="course-view-material-file-name">
            <label class="material-file-name link-txt fileDownload">Material of 12th lecture</label>
            <span class="fileName">network-computing.pdf</span>
            <span class="resource_Id">1049686</span>
            <input type="hidden" id="dlMaterialId" value="609902">
          </div>
          <div class="course-view-material-update">2026/07/01</div>
        </div>
      </div>
      <div id="reportList">
        <div id="direct_report_237863" class="course-result-list sortReportBlock">
          <a class="course-view-report-name link-txt" href="/lms/course/report/submission?idnumber=2026_3747_3747-066_01&reportId=237863">Final Assignment</a>
          <span class="course-view-report-time-end timeEnd">2026/07/17 17:00</span>
          <div class="course-view-report-status submitStatus">未提出</div>
        </div>
      </div>`;
    const c = parseCourse(html, "2026_3747_3747-066_01");
    expect(c.name).toBe("ネットワークコンピューティング");
    expect(c.materials).toHaveLength(1);
    expect(c.materials[0]).toMatchObject({
      title: "Material of 12th lecture",
      fileName: "network-computing.pdf",
      resourceId: "1049686",
      contentId: "609902",
    });
    expect(c.materials[0]?.updatedAt).toBe("2026-07-01T00:00:00+09:00");
    expect(c.assignments).toHaveLength(1);
    expect(c.assignments[0]).toMatchObject({
      title: "Final Assignment",
      id: "237863",
      kind: "assignment",
      submitted: false,
      dueAt: "2026-07-17T17:00:00+09:00",
    });
  });
});

describe("parseSearchResults", () => {
  // 実 HTML 構造: tr.course-search-result-list 内の td.course-search-*
  it("公開カタログ情報を抽出する（履修外コースを含む）", () => {
    const html = `
      <table><tbody>
        <tr class="result-list course-search-result-list">
          <td class="course-search-course-name"><a class="linkToCoursetop" href="javascript:void(0);" id="2026_00_31509_01">情報システム基礎Ⅰ</a></td>
          <td class="course-search-teacher-name"><span>苗村 健,峯松 信明</span></td>
          <td class="course-search-nendo">2026</td>
          <td class="course-search-section">S</td>
          <td class="course-search-day-of-week">水曜日５時限</td>
          <td class="course-search-category"><span>教養学部(前期課程)</span></td>
          <td class="course-search-syllabus"><a class="course-search-syllabus-img" href="https://utas.adm.u-tokyo.ac.jp/campusweb/campussquare.do?_flowId=SYW0001000-flow&sso_linkcd=lms&lms_j_cd=2026_00_31509&lms_c_cd=838"></a></td>
        </tr>
      </tbody></table>`;
    const results = parseSearchResults(html);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.name).toBe("情報システム基礎Ⅰ");
    expect(r.idnumber).toBe("2026_00_31509_01");
    expect(r.teachers).toEqual(["苗村 健", "峯松 信明"]);
    expect(r.year).toBe(2026);
    expect(r.term).toBe("S");
    expect(r.organization).toBe("教養学部(前期課程)");
    expect(r.syllabusUrl).toContain("_flowId=SYW0001000-flow");
    expect(r.courseUrl).toContain("/lms/course?idnumber=2026_00_31509_01");
  });
});

describe("parseSyllabus", () => {
  // 実 HTML 構造: UTAS の table th/td ペア
  it("UTAS の th/td からタイトル・教員・フィールドを抽出する", () => {
    const html = `
      <table>
        <tr><th>開講科目名／Course Title</th><td>ネットワークコンピューティング／Network Computing</td></tr>
        <tr><th>主担当教員／Lead Instructor</th><td>中山 雅哉、関谷 勇司</td></tr>
        <tr><th>成績評価方法／Method of Evaluation</th><td>レポート</td></tr>
      </table>`;
    const url = "https://utas.adm.u-tokyo.ac.jp/campusweb/campussquare.do?_flowId=SYW0001000-flow";
    const s = parseSyllabus(html, "2026_3747_3747-066_01", url);
    expect(s.title).toBe("ネットワークコンピューティング／Network Computing");
    expect(s.teachers).toEqual(["中山 雅哉", "関谷 勇司"]);
    expect(s.fields["成績評価方法／Method of Evaluation"]).toBe("レポート");
    expect(s.url).toBe(url);
  });
});

describe("isAllowedUtasSyllabusUrl (ガードレール)", () => {
  it("シラバス参照フローのみ許可する", async () => {
    const { isAllowedUtasSyllabusUrl } = await import("../src/browser/client.js");
    expect(
      isAllowedUtasSyllabusUrl(
        "https://utas.adm.u-tokyo.ac.jp/campusweb/campussquare.do?_flowId=SYW0001000-flow&lms_j_cd=x",
      ),
    ).toBe(true);
    // 別フロー（お知らせ等）は拒否
    expect(
      isAllowedUtasSyllabusUrl(
        "https://utas.adm.u-tokyo.ac.jp/campusweb/campussquare.do?_flowId=KHW0001100-flow",
      ),
    ).toBe(false);
    // 別ホスト・別パスは拒否
    expect(isAllowedUtasSyllabusUrl("https://evil.example.com/x?_flowId=SYW0001000-flow")).toBe(false);
    expect(isAllowedUtasSyllabusUrl("https://utas.adm.u-tokyo.ac.jp/other?_flowId=SYW0001000-flow")).toBe(false);
  });
});

describe("looksLikeLoginPage", () => {
  it("origin 外への遷移を未ログインと判定", () => {
    expect(looksLikeLoginPage("https://idp.he.u-tokyo.ac.jp/idp/x", "")).toBe(true);
  });
  it("/login パスを未ログインと判定", () => {
    expect(looksLikeLoginPage("https://utol.ecc.u-tokyo.ac.jp/login", "")).toBe(true);
  });
  it("SAML マーカーを含む本文を未ログインと判定", () => {
    expect(
      looksLikeLoginPage("https://utol.ecc.u-tokyo.ac.jp/lms/timetable", "<input name='SAMLRequest'>"),
    ).toBe(true);
  });
  it("通常の時間割ページはログイン済み扱い", () => {
    expect(
      looksLikeLoginPage("https://utol.ecc.u-tokyo.ac.jp/lms/timetable", "<div id='selectTimetable'></div>"),
    ).toBe(false);
  });
});
