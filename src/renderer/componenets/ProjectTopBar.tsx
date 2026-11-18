import { observer } from 'mobx-react-lite';
import { isMobile } from '../models';
import { appState } from '../models/AppService';
import { resolveLayout } from '../models/layoutTemplates';
import { StackFixed } from './LayoutComponents';
import SessionSelect from './SessionSelect';

/** Project commands live below the desktop title bar; generation stays docked below. */
const ProjectTopBar = observer(() => {
  const layout = resolveLayout(appState.uiLayoutTemplate, isMobile);
  if (isMobile || layout.projectSidebar || layout.projectStrip) return null;
  return (
    <StackFixed>
      <div data-project-top-bar="" className="zone-bar px-3 py-2 border-b line-color">
        <SessionSelect />
      </div>
    </StackFixed>
  );
});

export default ProjectTopBar;
