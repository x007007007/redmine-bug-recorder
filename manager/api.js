// 后台消息调用封装。

export function send(msg) {
  return chrome.runtime.sendMessage(msg).then((res) => {
    if (res && res.error) throw new Error(res.error);
    return res;
  });
}
