import { observer } from 'mobx-react-lite';
import { isMobile } from '../models';
import { appState } from '../models/AppService';
import { resolveLayout } from '../models/layoutTemplates';
import { StackFixed } from './LayoutComponents';
import SessionSelect from './SessionSelect';
import { AppToolbarControls } from './TobBar';

/** Project commands live below the desktop title bar; generation stays docked below. */
const ProjectTopBar = observer(() => {
  const layout = resolveLayout(appState.uiLayoutTemplate, isMobile);
  if (isMobile) return null;
  return (
    <StackFixed>
      <div data-project-top-bar="" className="zone-bar px-3 py-2 border-b line-color flex flex-wrap items-center gap-3">
        {!layout.projectSidebar && !layout.projectStrip && <div className="flex-1 min-w-0"><SessionSelect /></div>}
        <div className="ml-auto flex-none"><AppToolbarControls /></div>
      </div>
    </StackFixed>
  );
});

export default ProjectTopBar;
