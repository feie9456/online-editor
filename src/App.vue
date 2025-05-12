<script setup lang="ts">
import * as monaco from 'monaco-editor';
import { onMounted, ref, watch } from 'vue';
import './worker'

const originCode = ref('')

let editor: monaco.editor.IStandaloneCodeEditor | null = null;
const errors = ref<monaco.editor.IMarker[]>([]);
onMounted(async () => {
  const container = document.querySelector('.monaco-container') as HTMLDivElement;
  if (!container) return;
  // 设置语言服务配置
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
    const markers = monaco.editor.getModelMarkers({ resource: uri })
    errors.value = markers
  })
  editor = monaco.editor.create(container, {
    value: `"Loading..."`,
    language: 'typescript',
    automaticLayout: true,
    contextmenu: true,
    fontFamily: 'Fira Code',
    fontLigatures: true,
    theme: colorMode.value === 'light' ? 'vs' : 'vs-dark',
    fontSize: fontSize.value,
  });
  // 创建编辑器
  try {
    const url = new URL('file/' + filePath.value, serverPath.value)
    url.searchParams.append('secretKey', secretKey.value)
    const res = await fetch(url)
    const code = await res.text()
    if (!res.ok)
      originCode.value = `加载文件失败，请检查设置：\n${JSON.stringify(JSON.parse(code), null, 2)}`
    else
      originCode.value = code
  } catch (error) {
    originCode.value = `加载文件失败，请检查设置：\n${JSON.stringify(error, null, 2)}`
  }
  editor.setValue(originCode.value)
});


async function upload() {
  if (!editor) return
  if (!confirm('文件将被覆盖，历史文件将被备份并保留。\n\n请确认无报错后再上传，否则可能导致编译错误或运行时错误。\n\n确认上传吗？')) return
  const value = editor.getValue()
  footSelection.value = 'logs'
  const url = new URL('file/' + filePath.value, serverPath.value)
  url.searchParams.append('secretKey', secretKey.value)
  logContent.value += `[${new Date().toLocaleString()}] 开始上传...\n`
  try {
    const res = await fetch(url, {
      body: value,
      method: 'POST'
    })
    const code = await res.text()
    if (!res.ok)
      logContent.value += `[${new Date().toLocaleString()}] 上传失败：\n${JSON.stringify(JSON.parse(code), null, 2)}\n`
    else
      logContent.value += `[${new Date().toLocaleString()}] 上传成功！\n`
  } catch (error) {
    logContent.value += `[${new Date().toLocaleString()}] 上传失败：\n${JSON.stringify(error, null, 2)}\n`
  }

}
const params = new URLSearchParams(window.location.search);

const serverPath = ref(params.get('server') ?? location.origin)
const filePath = ref(params.get('path') ?? '')
const secretKey = ref(params.get('key') ?? '')
const footSelection = ref('errors')

console.log(params);

const showSettings = ref(false)

function saveSettings() {
  const url = new URL(window.location.href)
  if (serverPath.value !== url.origin)
    url.searchParams.set('server', serverPath.value)
  url.searchParams.set('path', filePath.value)
  url.searchParams.set('key', secretKey.value)
  window.location.href = url.href
}


const logContent = ref("")

async function compile() {
  footSelection.value = 'logs'
  const url = new URL('compile/' + filePath.value, serverPath.value)
  url.searchParams.append('secretKey', secretKey.value)
  logContent.value += `[${new Date().toLocaleString()}] 正在发送编译任务...\n`

  const sse = new EventSource(url)

  // 监听标准输出
  sse.addEventListener('stdout', (event) => {
    logContent.value += `${event.data}`
  })

  // 监听标准错误
  sse.addEventListener('stderr', (event) => {
    logContent.value += `${event.data}`
  })

  // 监听编译完成事件
  sse.addEventListener('close', (event) => {
    logContent.value += `[${new Date().toLocaleString()}] 编译完成，退出码：${event.data}\n`
    sse.close() // 关闭 EventSource 连接
  })

  sse.onerror = event => {
    logContent.value += `[${new Date().toLocaleString()}] 编译失败：\n${JSON.stringify(event, null, 2)}\n`
    sse.close() // 发生错误时也要关闭连接
  }

  sse.onopen = () => {
    logContent.value += `[${new Date().toLocaleString()}] 开始编译...\n`
  }
}
const footerHeight = ref(200)
function resize(event: PointerEvent) {
  if (event.buttons != 1) return
  event.preventDefault()
  let target = event.target as HTMLElement
  target.setPointerCapture(event.pointerId)
  console.log(event.movementY);
  footerHeight.value -= event.movementY
  if (footerHeight.value < 32) footerHeight.value = 32
}

const logContentContainer = ref<HTMLDivElement | null>(null)
watch(logContent, () => {
  if (!logContentContainer.value) return
  requestAnimationFrame(() => {
    logContentContainer.value!.scrollIntoView({ behavior: 'smooth', block: 'end' })
  })
})
const colorMode = ref<'light' | 'dark'>((localStorage.getItem('colorMode') as 'light' | 'dark') ?? 'dark')

watch(colorMode, () => {
  if (!editor) return
  editor.updateOptions({
    theme: colorMode.value === 'light' ? 'vs' : 'vs-dark'
  })
  localStorage.setItem('colorMode', colorMode.value)
})

const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
  navigator.userAgent
);

const fontSize = ref(+(localStorage.getItem('fontSize') ?? (isMobile ? '11' : '14')))

watch(fontSize, () => {
  if (!editor) return
  editor.updateOptions({
    fontSize: fontSize.value
  })
  localStorage.setItem('fontSize', fontSize.value.toString())
})
const showSecretKeyCalculator = ref(false)
const secretKeyCalculatorData = ref({
  filePath: '',
  secretKey: '',
  result: ''
})
async function createHmac(message: string, secretKey: string) {
  // 将消息和密钥转换为 Uint8Array
  const encoder = new TextEncoder();
  const messageBuffer = encoder.encode(message);
  const keyBuffer = encoder.encode(secretKey);

  // 导入密钥
  const key = await window.crypto.subtle.importKey(
    'raw',
    keyBuffer,
    {
      name: 'HMAC',
      hash: { name: 'SHA-256' }
    },
    false,
    ['sign']
  );

  // 计算 HMAC
  const signature = await window.crypto.subtle.sign(
    'HMAC',
    key,
    messageBuffer
  );

  // 转换为十六进制字符串
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
watch(secretKeyCalculatorData, () => {
  if (secretKeyCalculatorData.value.filePath === '' || secretKeyCalculatorData.value.secretKey === '') {
    secretKeyCalculatorData.value.result = ''
    return
  }
  createHmac(secretKeyCalculatorData.value.filePath, secretKeyCalculatorData.value.secretKey)
    .then(result => {
      secretKeyCalculatorData.value.result = result
    })
},{deep: true})
</script>

<template>
  <div class="app" :class="{ 'dark-mode': colorMode === 'dark' }">
    <header>
      <div class="title">鹅鹅协作编辑器</div>
      <div class="action">
        <button @click="showSettings = !showSettings">设置</button>
        <button @click="colorMode = colorMode === 'light' ? 'dark' : 'light'">{{
          colorMode === 'light' ? 'Dark' : 'Light' }}</button>
        <button
          @click="editor?.getAction('editor.action.formatDocument')!.run()">格式化</button>
        <button @click="upload">上传</button>
        <button @click="compile">编译</button>
      </div>
    </header>
    <main class="">
      <div class="monaco-container"></div>
    </main>
    <div class="resize-bar">
      <div class="pointer-catcher" @pointermove="resize" @touchstart.prevent>
      </div>
    </div>
    <footer :style="{ height: `${footerHeight}px` }">
      <div class="selector">
        <div class="item" :class="{ active: footSelection === 'errors' }"
          @click="footSelection = 'errors'">问题</div>
        <div class="item" :class="{ active: footSelection === 'logs' }"
          @click="footSelection = 'logs'">日志</div>
      </div>
      <div class="content">
        <div class="errors" v-if="footSelection === 'errors'">
          <div class="item" v-for="(error, index) in errors">
            <div class="index">{{ index + 1 }}.</div>
            <div class="content">{{ error.message }}</div>
            <div class="position">
              [行{{ error.startLineNumber }}, 列{{ error.startColumn }}]
            </div>
          </div>
        </div>
        <div class="logs" v-if="footSelection === 'logs'" v-html="logContent"
          ref="logContentContainer">
        </div>
      </div>
    </footer>
    <div class="mask" v-if="showSettings">
      <div class="settings content">
        <div class="title">设置</div>
        <div class="item">
          <label for="file-path">编辑器字体大小</label>
          <input type="number" id="server-path" v-model="fontSize"
            spellcheck="false">
        </div>
        <div class="item">
          <label for="file-path">Server</label>
          <input type="text" id="server-path" v-model="serverPath"
            spellcheck="false">
        </div>
        <div class="item">
          <label for="file-path">文件路径</label>
          <input type="text" id="file-path" v-model="filePath"
            spellcheck="false">
        </div>
        <div class="item">
          <label for="secret-key">Secret Key</label>
          <textarea type="text" id="secret-key" v-model="secretKey"
            spellcheck="false" />
        </div>
        <div class="action">
          <button @click="showSecretKeyCalculator = true">Secret Key
            计算器</button>
          <div class="placeholder"></div>
          <button @click="showSettings = false">取消</button>
          <button @click="saveSettings">保存</button>
        </div>
      </div>
    </div>
    <div class="mask" v-if="showSecretKeyCalculator">
      <div class="content">
        <div class="title">Secret Key 计算器</div>
        <div class="item">
          <label for="file-path">文件路径</label>
          <input type="text" v-model="secretKeyCalculatorData.filePath"
            spellcheck="false">
        </div>
        <div class="item">
          <label for="secret-key">加密密钥</label>
          <textarea type="text" v-model="secretKeyCalculatorData.secretKey"
            spellcheck="false" />
        </div>
        <div class="item">
          <label for="secret-key">Secret Key</label>
          <textarea type="text" id="secret-key"
            v-model="secretKeyCalculatorData.result" spellcheck="false"
            readonly />
        </div>
        <div class="action">
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

      textarea,
      input {
        border: 1px solid #FFFFFF33;
        background-color: #000000EE;
        color: #FFFFFFEE;
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
    border-radius: 5px;
    box-shadow: 0 0 10px #00000033;
    >.title{
      font-size: larger;
      margin-bottom: 20px;
    }
    label {
      display: block;
      margin-bottom: 10px;
    }

    textarea,
    input {
      width: 100%;
      padding: 8px;
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
