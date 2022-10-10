import { FileObj } from '../typings';
import { pluginExif } from './pluginExif';
import { pluginMd5 } from './pluginMd5';

const _plugins = [
  // pluginExif,
  pluginMd5
]

export const plugins = {
  async invoke(fileObj: FileObj) {
    for (const plugin of _plugins) {
      await plugin.invoke(fileObj)
    }
  },
  use(plugin) {
    _plugins.push(plugin);
  }
}