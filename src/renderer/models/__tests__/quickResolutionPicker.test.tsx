import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
jest.mock('../AppService', () => ({ appState: { pushMessage: jest.fn(), pushDialog: jest.fn() } }));
jest.mock('../BackStackService', () => ({ useBackLayer: jest.fn() }));
import { appState } from '../AppService';
import { ResolutionPicker } from '../../componenets/ResolutionPicker';
import { readQuickResolutionSettings } from '../quickResolution';
function Fixture() {
  const [settings, setSettings] = useState(readQuickResolutionSettings(undefined));
  return <ResolutionPicker value={{ resolution: 'portrait' }} onApply={jest.fn()} random={{ ...settings, onChange: setSettings }} />;
}
beforeEach(() => jest.clearAllMocks());
test('selects multiple sizes, adds custom sizes, and prevents an empty random pool', () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '832x1216' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '랜덤 크기' }));
  expect(screen.getByRole('button', { name: '랜덤 3개' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '1216x832' }));
  fireEvent.click(screen.getByRole('button', { name: '1024x1024' }));
  fireEvent.click(screen.getByRole('button', { name: '832x1216' }));
  expect(appState.pushMessage).toHaveBeenCalledWith('랜덤 크기는 하나 이상 선택해주세요.');
  expect(screen.getByRole('button', { name: '랜덤 1개' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('이미지 너비'), { target: { value: '768' } });
  fireEvent.change(screen.getByLabelText('이미지 높이'), { target: { value: '1280' } });
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(screen.getByRole('button', { name: '랜덤 2개' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '768x1280 직접 입력' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '추가' }));
  expect(screen.getByRole('button', { name: '랜덤 2개' })).toBeTruthy();
});
test('confirms before adding a paid preset and returns to the fixed size', () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '832x1216' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '랜덤 크기' }));
  fireEvent.click(screen.getByRole('button', { name: '1536x1024 Anlas' }));
  expect(appState.pushDialog).toHaveBeenCalledWith(expect.objectContaining({ type: 'confirm' }));
  expect(screen.getByRole('button', { name: '랜덤 3개' })).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: '랜덤 크기' }));
  expect(screen.getAllByRole('button', { name: '832x1216' })).toHaveLength(2);
});
