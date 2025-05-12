<script setup lang="ts">
import * as monaco from 'monaco-editor';
import { onMounted, ref, watch } from 'vue';
import './worker';

const params = new URLSearchParams(window.location.search);
const serverPath = ref(params.get('server') ?? location.origin);
const filePath = ref(params.get('path') ?? '');
const secretKey = ref(params.get('key') ?? '');
const footSelection = ref<'errors' | 'logs'>('errors');

// 添加加密密钥的本地存储
const encryptionKey = ref(localStorage.getItem('encryptionKey') ?? '');
// 监听加密密钥变化并保存
watch(encryptionKey, (newValue) => {
  localStorage.setItem('encryptionKey', newValue);
});

console.log(params);

/* --------------- 新增：语言检测及用户选择 --------------- */
type MonacoLanguage =
  | 'typescript' | 'javascript' | 'markdown' | 'json' | 'html'
  | 'css' | 'scss' | 'sass' | 'vue' | 'plaintext';

const languageSelection = ref<'auto' | MonacoLanguage>(
  (localStorage.getItem('languageSelection') as 'auto' | MonacoLanguage) ?? 'auto'
);
const selectedLanguage = ref<MonacoLanguage>(languageSelection.value === 'auto' ? detectLanguageByPath(filePath.value) : languageSelection.value);

/** 根据文件扩展名推断编辑语言 */
function detectLanguageByPath(path: string): MonacoLanguage {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'md':
    case 'mdx':
      return 'markdown';
    case 'html':
    case 'htm':
      return 'html';
    case 'scss':
      return 'scss';
    case 'sass':
      return 'sass';
    case 'css':
      return 'css';
    case 'vue':
      return 'vue';
    default:
      return 'plaintext';
  }
}
/* ------------------------------------------------------- */

const originCode = ref('');
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
const errors = ref<monaco.editor.IMarker[]>([]);

onMounted(async () => {
  const container = document.querySelector('.monaco-container') as HTMLDivElement;
  if (!container) return;

  /* 设置 TS 语言服务配置（对其他语言不产生影响） */
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    allowNonTsExtensions: true,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    jsx: monaco.languages.typescript.JsxEmit.React,
    esModuleInterop: true,
    strict: true,
  });
  

  monaco.editor.onDidChangeMarkers(([uri]) => {
    errors.value = monaco.editor.getModelMarkers({ resource: uri });
  });

  console.log(`当前语言：${selectedLanguage.value}`);

  editor = monaco.editor.create(container, {
    value: `"Loading..."`,
    language: selectedLanguage.value,
    automaticLayout: true,
    contextmenu: true,
    fontFamily: 'Fira Code',
    fontLigatures: true,
    theme: colorMode.value === 'light' ? 'vs' : 'vs-dark',
    fontSize: fontSize.value,
    wordWrap: wordWrap.value,
  });

  /* 读取文件内容并填充编辑器 */
  try {
    const url = new URL('file/' + encodeURI(filePath.value), serverPath.value);
    url.searchParams.append('secretKey', secretKey.value);
    const res = await fetch(url);
    const code = await res.text();
    if (!res.ok)
      originCode.value = `加载文件失败，请检查设置：\n${JSON.stringify(JSON.parse(code), null, 2)}`;
    else
      originCode.value = code;
  } catch (error) {
    originCode.value = `加载文件失败，请检查设置：\n${JSON.stringify(error, null, 2)}`;
  }
  editor.setValue(originCode.value);
});

/* ------------ watch：文件路径或语言选择变化时切换语言 ------------- */
watch([filePath, languageSelection], () => {
  if (languageSelection.value === 'auto')
    selectedLanguage.value = detectLanguageByPath(filePath.value);
  else
    selectedLanguage.value = languageSelection.value;

  // 当文件路径变更时，如果有加密密钥，自动重新生成 Secret Key
  if (encryptionKey.value && filePath.value) {
    createHmac(filePath.value, encryptionKey.value).then(result => {
      secretKey.value = result;
    });
  }
});

watch(selectedLanguage, () => {
  if (editor && editor.getModel())
    monaco.editor.setModelLanguage(editor.getModel()!, selectedLanguage.value);
});
/* ------------------------------------------------------------------ */

async function upload() {
  if (!editor) return;
  if (
    !confirm(
      '文件将被覆盖，历史文件将被备份并保留。\n\n请确认无报错后再上传，否则可能导致编译错误或运行时错误。\n\n确认上传吗？'
    )
  )
    return;
  const value = editor.getValue();
  footSelection.value = 'logs';
  const url = new URL('file/' + encodeURI(filePath.value), serverPath.value);
  url.searchParams.append('secretKey', secretKey.value);
  logContent.value += `[${new Date().toLocaleString()}] 开始上传...\n`;
  try {
    const res = await fetch(url, {
      body: value,
      method: 'POST',
    });
    const code = await res.text();
    if (!res.ok)
      logContent.value += `[${new Date().toLocaleString()}] 上传失败：\n${JSON.stringify(
        JSON.parse(code),
        null,
        2
      )}\n`;
    else logContent.value += `[${new Date().toLocaleString()}] 上传成功！\n`;
  } catch (error) {
    logContent.value += `[${new Date().toLocaleString()}] 上传失败：\n${JSON.stringify(
      error,
      null,
      2
    )}\n`;
  }
}

const showSettings = ref(false);

function saveSettings() {
  const url = new URL(window.location.href);
  if (serverPath.value !== url.origin) url.searchParams.set('server', serverPath.value);
  url.searchParams.set('path', filePath.value);

  // 如果有加密密钥，自动生成 Secret Key
  if (encryptionKey.value && filePath.value) {
    createHmac(filePath.value, encryptionKey.value).then(result => {
      secretKey.value = result;
      url.searchParams.set('key', secretKey.value);
      localStorage.setItem('languageSelection', languageSelection.value);
      window.location.href = url.href;
    });
  } else {
    url.searchParams.set('key', secretKey.value);
    localStorage.setItem('languageSelection', languageSelection.value);
    window.location.href = url.href;
  }
}

const logContent = ref('');
async function compile() {
  footSelection.value = 'logs';
  const url = new URL('compile/' + encodeURI(filePath.value), serverPath.value);
  url.searchParams.append('secretKey', secretKey.value);
  logContent.value += `[${new Date().toLocaleString()}] 正在发送编译任务...\n`;

  const sse = new EventSource(url);
  sse.addEventListener('stdout', (event) => (logContent.value += `${event.data}`));
  sse.addEventListener('stderr', (event) => (logContent.value += `${event.data}`));
  sse.addEventListener('close', (event) => {
    logContent.value += `[${new Date().toLocaleString()}] 编译完成，退出码：${event.data}\n`;
    sse.close();
  });
  sse.onerror = (event) => {
    logContent.value += `[${new Date().toLocaleString()}] 编译失败：\n${JSON.stringify(event, null, 2)}\n`;
    sse.close();
  };
  sse.onopen = () => (logContent.value += `[${new Date().toLocaleString()}] 开始编译...\n`);
}

const footerHeight = ref(200);
function resize(event: PointerEvent) {
  if (event.buttons != 1) return;
  event.preventDefault();
  (event.target as HTMLElement).setPointerCapture(event.pointerId);
  footerHeight.value -= event.movementY;
  if (footerHeight.value < 32) footerHeight.value = 32;
}

const logContentContainer = ref<HTMLDivElement | null>(null);
watch(logContent, () => {
  if (!logContentContainer.value) return;
  requestAnimationFrame(() =>
    logContentContainer.value!.scrollIntoView({ behavior: 'smooth', block: 'end' })
  );
});

const colorMode = ref<'light' | 'dark'>(
  (localStorage.getItem('colorMode') as 'light' | 'dark') ?? 'dark'
);
watch(colorMode, () => {
  if (!editor) return;
  editor.updateOptions({ theme: colorMode.value === 'light' ? 'vs' : 'vs-dark' });
  localStorage.setItem('colorMode', colorMode.value);
});

// 添加自动换行设置
const wordWrap = ref<'off' | 'on'>(
  (localStorage.getItem('wordWrap') as 'off' | 'on') ?? 'on'
);
watch(wordWrap, () => {
  if (!editor) return;
  editor.updateOptions({ wordWrap: wordWrap.value });
  localStorage.setItem('wordWrap', wordWrap.value);
});

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  navigator.userAgent
);
const fontSize = ref<number>(+(localStorage.getItem('fontSize') ?? (isMobile ? '11' : '14')));
watch(fontSize, () => {
  if (!editor) return;
  editor.updateOptions({ fontSize: fontSize.value });
  localStorage.setItem('fontSize', fontSize.value.toString());
});

/* ---- Secret Key 计算器逻辑 ---- */
const showSecretKeyCalculator = ref(false);
const secretKeyCalculatorData = ref({ filePath: '', secretKey: '', result: '' });

// 当打开高级计算器时，自动填充当前文件路径和加密密钥
watch(showSecretKeyCalculator, (isVisible) => {
  if (isVisible) {
    secretKeyCalculatorData.value.filePath = filePath.value;
    secretKeyCalculatorData.value.secretKey = encryptionKey.value;
    // 如果有值，自动计算结果
    if (secretKeyCalculatorData.value.filePath && secretKeyCalculatorData.value.secretKey) {
      createHmac(secretKeyCalculatorData.value.filePath, secretKeyCalculatorData.value.secretKey).then(
        (result) => (secretKeyCalculatorData.value.result = result)
      );
    }
  }
});

async function createHmac(message: string, secretKey: string) {
  if (!message || !secretKey) return '';

  const encoder = new TextEncoder();
  const messageBuffer = encoder.encode(message);
  const keyBuffer = encoder.encode(secretKey);
  const key = await window.crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );
  const signature = await window.crypto.subtle.sign('HMAC', key, messageBuffer);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

watch(
  secretKeyCalculatorData,
  () => {
    if (secretKeyCalculatorData.value.filePath === '' || secretKeyCalculatorData.value.secretKey === '') {
      secretKeyCalculatorData.value.result = '';
      return;
    }
    createHmac(secretKeyCalculatorData.value.filePath, secretKeyCalculatorData.value.secretKey).then(
      (result) => (secretKeyCalculatorData.value.result = result)
    );
  },
  { deep: true }
);
</script>

<template>
  <div class="app" :class="{ 'dark-mode': colorMode === 'dark' }">
    <header>
      <div class="title">鹅鹅协作编辑器</div>
      <div class="action">
        <button @click="showSettings = !showSettings">设置</button>
        <button @click="colorMode = colorMode === 'light' ? 'dark' : 'light'">
          {{ colorMode === 'light' ? 'Dark' : 'Light' }}
        </button>
        <button @click="editor?.getAction('editor.action.formatDocument')!.run()">格式化</button>
        <button @click="upload">上传</button>
        <button @click="compile">编译</button>
      </div>
    </header>

    <main>
      <div class="monaco-container" />
    </main>

    <div class="resize-bar">
      <div class="pointer-catcher" @pointermove="resize" @touchstart.prevent />
    </div>

    <footer :style="{ height: `${footerHeight}px` }">
      <div class="selector">
        <div class="item" :class="{ active: footSelection === 'errors' }" @click="footSelection = 'errors'">
          问题
        </div>
        <div class="item" :class="{ active: footSelection === 'logs' }" @click="footSelection = 'logs'">
          日志
        </div>
      </div>
      <div class="content">
        <div class="errors" v-if="footSelection === 'errors'">
          <div class="item" v-for="(error, index) in errors" :key="index">
            <div class="index">{{ index + 1 }}.</div>
            <div class="content">{{ error.message }}</div>
            <div class="position">[行{{ error.startLineNumber }}, 列{{ error.startColumn }}]</div>
          </div>
        </div>
        <div class="logs" v-if="footSelection === 'logs'" v-html="logContent" ref="logContentContainer" />
      </div>
    </footer>

    <!-- 设置弹窗 -->
    <div class="mask" v-if="showSettings">
      <div class="settings content">
        <div class="title">设置</div>

        <!-- 新增：语言服务选择 -->
        <div class="item">
          <label for="language-select">语言服务</label>
          <select id="language-select" v-model="languageSelection">
            <option value="auto">自动检测</option>
            <option value="typescript">TypeScript</option>
            <option value="javascript">JavaScript</option>
            <option value="markdown">Markdown</option>
            <option value="json">JSON</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
            <option value="scss">SCSS</option>
            <option value="sass">Sass</option>
            <option value="vue">Vue</option>
            <option value="plaintext">Plain Text</option>
          </select>
        </div>

        <div class="item">
          <label for="font-size">编辑器字体大小</label>
          <input type="number" id="font-size" v-model="fontSize" spellcheck="false" />
        </div>

        <div class="item">
          <label for="word-wrap">自动换行</label>
          <select id="word-wrap" v-model="wordWrap">
            <option value="on">开启</option>
            <option value="off">关闭</option>
          </select>
        </div>

        <div class="item">
          <label for="server-path">Server</label>
          <input type="text" id="server-path" v-model="serverPath" spellcheck="false" />
        </div>

        <div class="item">
          <label for="file-path">文件路径</label>
          <input type="text" id="file-path" v-model="filePath" spellcheck="false" />
        </div>

        <div class="item">
          <label for="encryption-key">加密密钥</label>
          <div class="input-with-button">
            <input type="text" id="encryption-key" v-model="encryptionKey" spellcheck="false" />
            <button @click="createHmac(filePath, encryptionKey).then(result => secretKey = result)"
              title="生成 Secret Key">生成</button>
          </div>
        </div>

        <div class="item">
          <label for="secret-key">Secret Key</label>
          <textarea id="secret-key" v-model="secretKey" spellcheck="false" />
        </div>

        <div class="action">
          <button @click="showSecretKeyCalculator = true">高级计算器</button>
          <div class="placeholder" />
          <button @click="showSettings = false">取消</button>
          <button @click="saveSettings">保存</button>
        </div>
      </div>
    </div>

    <!-- Secret Key 计算器 (高级模式) -->
    <div class="mask" v-if="showSecretKeyCalculator">
      <div class="content">
        <div class="title">Secret Key 高级计算器</div>
        <div class="item">
          <label>文件路径</label>
          <input type="text" v-model="secretKeyCalculatorData.filePath" spellcheck="false" />
        </div>
        <div class="item">
          <label>加密密钥</label>
          <textarea v-model="secretKeyCalculatorData.secretKey" spellcheck="false" />
        </div>
        <div class="item">
          <label>Secret Key</label>
          <textarea v-model="secretKeyCalculatorData.result" spellcheck="false" readonly />
        </div>
        <div class="action">
          <button
            @click="encryptionKey = secretKeyCalculatorData.secretKey; secretKey = secretKeyCalculatorData.result; showSecretKeyCalculator = false">应用并关闭</button>
          <button @click="showSecretKeyCalculator = false">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.placeholder {
  flex: 1;
}

.mask .content .input-with-button {
  display: flex;
  gap: 8px;
  width: 100%;

  input {
    flex: 1;
    margin-bottom: 0;
  }

  margin-bottom: 20px;
}

.app.dark-mode {
  background-color: #191919;

  header {
    color: #fff;
    border-bottom: 1px solid #FFFFFF33;
  }

  button {
    border: 1px solid #ccc;
    color: #FFFFFFEE;
    background-color: #00000022;

    &:hover {
      background-color: #FFFFFF22;
    }

    &:active {
      background-color: #FFFFFF33;
    }
  }

  footer {
    color: #FFFFFFEE;
  }

  .resize-bar {
    background-color: #FFFFFF33;
  }

  .mask {
    color: #FFFFFFEE;

    .content {
      background-color: #1E1E1E;
      select,
      textarea,
      input {
        border: 1px solid #FFFFFF33;
        background-color: #000000EE;
        color: #FFFFFFEE;
      }
      
      &::-webkit-scrollbar-thumb {
        background-color: #424242;
      }

      &::-webkit-scrollbar-thumb:hover {
        background-color: #4F4F4F;
      }

      &::-webkit-scrollbar-thumb:active {
        background-color: #5E5E5E;
      }

      &::-webkit-scrollbar {
        width: 14px;
      }
    }
  }

  footer>.content {
    &::-webkit-scrollbar-thumb {
      background-color: #424242;
    }

    &::-webkit-scrollbar-thumb:hover {
      background-color: #4F4F4F;
    }

    &::-webkit-scrollbar-thumb:active {
      background-color: #5E5E5E;
    }

    &::-webkit-scrollbar {
      width: 14px;
    }
  }
}


footer>.content {
  &::-webkit-scrollbar-thumb {
    background-color: #C1C1C0;
  }

  &::-webkit-scrollbar-thumb:hover {
    background-color: #929292;
  }

  &::-webkit-scrollbar-thumb:active {
    background-color: #666666;
  }


  &::-webkit-scrollbar {
    width: 14px;
  }
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 12px;
  box-shadow: 0 0 10px #00000022;
  z-index: 1;
  user-select: none;
  min-height: 40px;

  .action {
    display: flex;
    gap: 12px;
  }
}

.mask {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 9999;
  display: flex;
  justify-content: center;
  align-items: center;

  .content {
    background-color: #fff;
    padding: 20px;
    min-width: min(500px, 95vw);
    max-height: 90vh;
    overflow-y: auto;
    border-radius: 5px;
    box-shadow: 0 0 10px #00000033;
    
    &::-webkit-scrollbar-thumb {
      background-color: #C1C1C0;
    }

    &::-webkit-scrollbar-thumb:hover {
      background-color: #929292;
    }

    &::-webkit-scrollbar-thumb:active {
      background-color: #666666;
    }

    &::-webkit-scrollbar {
      width: 14px;
    }

    >.title {
      font-size: larger;
      margin-bottom: 20px;
    }

    label {
      display: block;
      margin-bottom: 10px;
    }

    select {
      width: 100%;
      padding: 8px;
      border: 1px solid #ccc;
      border-radius: 5px;
      margin-bottom: 20px;
      font-family: 'Fira Code', Consolas, 'Courier New', monospace;
      background-color: #FFF;
      color: inherit;
      height: 32px;
      appearance: none;
      --webkit-appearance: none;
      border: 1px solid #ccc;
    }

    button {
      padding: 6px 12px;
      border-radius: 5px;
      height: 32px;
      white-space: nowrap;
      min-width: 60px;
      border: 1px solid #ccc;
    }

    textarea,
    input {
      width: 100%;
      padding: 8px;
      height: 32px;
      border: 1px solid #ccc;
      border-radius: 5px;
      margin-bottom: 20px;
      font-family: 'Fira Code', Consolas, "Courier New", monospace;

    }
  }

  .action {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }
}

button {
  padding: 6px 16px;
  border: 1px solid #ccc;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.1s ease;
  color: #000000EE;

  &:hover {
    background-color: #00000022;
  }

  &:active {
    background-color: #00000033;
  }
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  width: 100%;
}

main {
  flex: 1;
  overflow: hidden;
}

.monaco-container {
  height: 100%;
}

.resize-bar {
  height: 1px;
  background-color: #ccc;
  position: relative;

  .pointer-catcher {
    height: 17px;
    width: 100%;
    position: absolute;
    z-index: 99;
    top: -8px;
    left: 0;
    cursor: ns-resize;
  }
}

footer {
  display: flex;
  flex-direction: column;

  &>.content {
    flex: 1;
    overflow-y: scroll;
    font-family: 'Fira Code', Consolas, "Courier New", monospace;
    font-size: smaller;
  }

  .selector {
    display: flex;
    font-size: small;
    user-select: none;

    .item {
      padding: 6px 12px;
      cursor: pointer;
      transition: all 0.1s ease;

      &.active {
        border-bottom: 1px solid #005FB8;
      }

      &:hover {
        background-color: #00000033;
      }
    }
  }
}

.errors {
  .item {
    padding: 4px 8px;
    transition: all 0.1s ease;
    display: flex;
    align-items: center;
    gap: 8px;

    &:hover {
      background-color: #00000033;
    }

    .content {
      flex: 1;
    }

    .position {
      font-size: smaller;
      color: #999;
    }
  }
}

.logs {
  padding: 4px 8px;
  line-height: 1.3;
  white-space: pre-wrap;
  scroll-behavior: smooth;
}

@media screen and (max-width: 600px) {

  header {
    button {
      padding: 4px 4px !important;
      min-width: 42px;
      font-size: small;
    }

    .action {
      gap: 4px;
    }
  }
}
</style>
