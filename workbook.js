const get = id => document.getElementById(id);
const pageRows = 100;
const pageColumns = 24;
let parser;
let book;
let activeSheet;
let rowOffset;
let columnOffset;

export const isWorkbook = name => /\.(xlsx|xlsm|xlsb|xls)$/i.test(name);

function loadParser() {
  if (parser) return parser;
  parser = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './vendor/xlsx.full.min.js?v=0.20.3';
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => {
      parser = undefined;
      script.remove();
      reject(new Error('엑셀 뷰어를 불러올 수 없습니다. 다시 시도해 주세요.'));
    };
    document.head.append(script);
  });
  return parser;
}

export async function readWorkbook(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const zip = data[0] === 0x50 && data[1] === 0x4b;
  const ole = data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0;
  const biff = data[0] === 0x09 && [0, 2, 4, 8].includes(data[1]);
  const message = '엑셀 표를 읽을 수 없습니다. 나스카나 암호로 보호된 파일은 권한이 있는 Excel에서 열어 주세요.';
  if (!zip && !ole && !biff) throw new Error(message);
  const xlsx = await loadParser();
  try {
    const content = xlsx.read(data, {cellHTML: false, cellFormula: false});
    const names = content.SheetNames.filter((_, i) => !content.Workbook?.Sheets?.[i]?.Hidden);
    if (names.length) return {xlsx, content, names};
  } catch {
    throw new Error(message);
  }
  throw new Error('표시할 시트가 없습니다.');
}

export function showWorkbook(workbook) {
  book = workbook;
  const buttons = workbook.names.map(name => {
    const button = document.createElement('button');
    button.textContent = name;
    button.onclick = () => selectSheet(name);
    return button;
  });
  get('sheetButtons').replaceChildren(...buttons);
  selectSheet(workbook.names[0]);
}

function selectSheet(name) {
  activeSheet = name;
  rowOffset = 0;
  columnOffset = 0;
  for (const button of get('sheetButtons').children) {
    button.setAttribute('aria-pressed', String(button.textContent === name));
  }
  renderSheet();
}

function header(row, text, scope) {
  const cell = document.createElement('th');
  cell.textContent = text;
  cell.scope = scope;
  row.append(cell);
}

function renderSheet() {
  const {utils} = book.xlsx;
  const sheet = book.content.Sheets[activeSheet];
  const grid = get('sheetGrid');
  get('sheetNavigation').hidden = !sheet['!ref'];
  if (!sheet['!ref']) {
    grid.textContent = '빈 시트입니다.';
    return;
  }
  const {s: first, e: last} = utils.decode_range(sheet['!ref']);
  const startRow = first.r + rowOffset;
  const startColumn = first.c + columnOffset;
  const endRow = Math.min(startRow + pageRows - 1, last.r);
  const endColumn = Math.min(startColumn + pageColumns - 1, last.c);
  const table = document.createElement('table');
  table.setAttribute('aria-label', activeSheet);
  const titles = table.createTHead().insertRow();
  header(titles, '', 'col');
  for (let col = startColumn; col <= endColumn; col++) header(titles, utils.encode_col(col), 'col');
  const body = table.createTBody();
  for (let row = startRow; row <= endRow; row++) {
    const line = body.insertRow();
    header(line, row + 1, 'row');
    for (let col = startColumn; col <= endColumn; col++) {
      const cell = sheet[utils.encode_cell({r: row, c: col})];
      line.insertCell().textContent = cell?.w ?? cell?.v ?? '';
    }
  }
  grid.replaceChildren(table);
  grid.scrollTo(0, 0);
  get('previousRows').disabled = rowOffset === 0;
  get('nextRows').disabled = endRow === last.r;
  get('previousColumns').disabled = columnOffset === 0;
  get('nextColumns').disabled = endColumn === last.c;
  get('sheetPosition').textContent = (startRow + 1) + '–' + (endRow + 1) + '행 · ' +
    utils.encode_col(startColumn) + '–' + utils.encode_col(endColumn) + '열';
}

get('previousRows').onclick = () => { rowOffset -= pageRows; renderSheet(); };
get('nextRows').onclick = () => { rowOffset += pageRows; renderSheet(); };
get('previousColumns').onclick = () => { columnOffset -= pageColumns; renderSheet(); };
get('nextColumns').onclick = () => { columnOffset += pageColumns; renderSheet(); };
