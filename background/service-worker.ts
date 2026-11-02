// 入口:注册各模块监听器(必须在顶层同步注册,满足 MV3 休眠唤醒要求)。

import { initState } from './state';
import { installNetCapture } from './net-capture';
import { installRecorder } from './recorder';
import { installRouter } from './router';

installNetCapture();
installRecorder();
installRouter();
void initState();
