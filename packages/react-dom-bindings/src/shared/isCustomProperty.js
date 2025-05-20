/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

function isCustomProperty(styleName: string): boolean {
  return styleName.length >= 2 && styleName[0] === '-' && styleName[1] === '-';
}

export default isCustomProperty;
