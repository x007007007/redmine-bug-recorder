// 入口:注册各模块监听器(必须在顶层同步注册,满足 MV3 休眠唤醒要求)。

import { init as initState } from './state.js';
import { install as installNetCapture } from './net-capture.js';
import { install as installRecorder } from './recorder.js';
import { install as installRouter } from './router.js';

installNetCapture();
installRecorder();
installRouter();
initState();
