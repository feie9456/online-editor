import * as monaco from 'monaco-editor';

import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// @ts-ignore
self.MonacoEnvironment = {
    getWorker() {
        return new tsWorker();
    }
};

monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);