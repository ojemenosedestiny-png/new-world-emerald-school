import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRows, mapColumns, normalSession, normalTerm, parseCsv, rowsFromCsv, templateCsv, type Lookups } from "./result-import";

test("result import: CSV with quotes, commas, semicolons and Excel's BOM is read correctly", () => {
  assert.deepEqual(parseCsv('﻿a,b,c\r\n1,"two, three","say ""hi"""\n\n4,5,6'), [["a", "b", "c"], ["1", "two, three", 'say "hi"'], ["4", "5", "6"]]);
  assert.deepEqual(parseCsv("a;b\n1;2,5"), [["a", "b"], ["1", "2,5"]]);
  assert.deepEqual(parseCsv('a,b\n"line\nbreak",x'), [["a", "b"], ["line\nbreak", "x"]]);
});

test("result import: headings are matched by name or common alternative, and required ones are named", () => {
  assert.deepEqual(mapColumns(["Admission No", "Class", "Session", "Term", "Subject", "Total Score"]).missing, []);
  assert.deepEqual(mapColumns(["Name", "Class"]).missing, ["Student ID", "Session", "Term", "Subject", "Total (or CA and Exam)"]);
  const { rows, missing } = rowsFromCsv(templateCsv());
  assert.deepEqual(missing, []);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].studentId, rows[0].subject, rows[0].total, rows[0].line], ["NWE/2021/00001", "Mathematics", "83", 2]);
});

test("result import: sessions and terms are understood in common forms", () => {
  assert.equal(normalSession("2021/2022"), "2021/2022");
  assert.equal(normalSession("2021-22"), "2021/2022");
  assert.equal(normalSession("2021/2023"), null);
  assert.equal(normalTerm("1st"), "First Term");
  assert.equal(normalTerm("Second term"), "Second Term");
  assert.equal(normalTerm("3"), "Third Term");
  assert.equal(normalTerm("Summer"), null);
});

test("result import: every row is checked, with errors not saved and warnings explained", () => {
  const lookups: Lookups = {
    students: new Map([["NWE/2021/00001", { id: 1, name: "Ada Obi" }], ["NWE/2021/00002", { id: 2, name: "Bayo Ade" }]]),
    classes: new Map([["jss1", { id: 10, name: "JSS 1" }]]),
    terms: new Map([["2021/2022|First Term", { id: 5, caMax: 30, examMax: 70 }]]),
    subjects: new Map([["10|mathematics", 100]]),
    existingScores: new Set(["5|1|100"]),
    locked: new Map(),
  };
  const csv = [
    "Student ID,Student name,Class,Session,Term,Subject,CA,Exam,Total,Grade",
    "nwe/2021/00001,Ada Obi,JSS1,2021/2022,1st,Mathematics,25,60,85,A",
    "NWE/2021/00001,Ada Obi,JSS 1,2021/22,First,mathematics,20,50,,",
    "NWE/2021/00002,Bayo A.,JSS 1,2021/2022,First Term,Basic Science,,,64,B",
    "NWE/2021/00009,Nobody,JSS 1,2021/2022,First Term,Mathematics,10,10,,",
    "NWE/2021/00002,Bayo Ade,SS 9,2022/2023,Second Term,Mathematics,40,10,,",
    "NWE/2021/00002,Bayo Ade,JSS 1,2021/2022,First Term,Mathematics,31,50,,",
    "NWE/2021/00002,Bayo Ade,JSS 1,2022/2023,Second Term,English,10,10,40,",
  ].join("\n");
  const rows = checkRows(rowsFromCsv(csv).rows, lookups, { caMax: 40, examMax: 60 });
  const [ada, adaAgain, bayo, nobody, badClass, tooHigh, newTerm] = rows;
  assert.equal(ada.status, "warning");
  assert.deepEqual([ada.studentDbId, ada.classId, ada.term, ada.total, ada.grade], [1, 10, "First Term", 85, "A"]);
  assert.match(ada.messages.join(), /already saved; it will be replaced/);
  assert.equal(adaAgain.status, "error");
  assert.match(adaAgain.messages.join(), /Duplicate/);
  assert.equal(bayo.status, "warning");
  assert.match(bayo.messages.join(), /Name differs: the portal has Bayo Ade/);
  assert.match(bayo.messages.join(), /New subject Basic Science will be added to JSS 1/);
  assert.match(nobody.messages.join(), /No student with ID NWE\/2021\/00009/);
  assert.match(badClass.messages.join(), /No class named SS 9/);
  assert.match(tooHigh.messages.join(), /CA "31" must be 0 to 30/, "the term's own maxima apply");
  assert.match(newTerm.messages.join(), /New term Second Term, 2022\/2023 will be created/);
  assert.match(newTerm.messages.join(), /Total 40 differs from CA \+ exam \(20\)/);

  const locked = checkRows(rowsFromCsv(csv).rows.slice(0, 1), { ...lookups, locked: new Map([["5|10", "published"]]) }, { caMax: 40, examMax: 60 });
  assert.match(locked[0].messages.join(), /are published. Return them to draft/);
});
