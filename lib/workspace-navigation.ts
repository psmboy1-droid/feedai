export const workspaceNavigationEvent='feedman:navigate';
export function navigateWorkspace(href:string){
 const event=new CustomEvent(workspaceNavigationEvent,{detail:href,cancelable:true});
 if(window.dispatchEvent(event))window.location.assign(href);
}
