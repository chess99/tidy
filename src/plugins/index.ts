import { FileObj } from '../typings';
import PluginExif from './PluginExif';

const _plugins = [PluginExif]

export const plugins = {
  invoke(fileObj: FileObj) {
    _plugins.forEach(plugin => {
      plugin.invoke(fileObj)
    })
  },
  use(plugin) {
    _plugins.push(plugin);
  }
}