// The one layout switch shared by the CSS and the 3D cameras: phones and portrait tablets stack the copy under the
// stage; landscape tablets and up put the copy beside it. Keep in step with the stacked @media rule in css/*.css.
export const STACKED = '(max-width: 767px), (max-width: 1024px) and (orientation: portrait)';
export const stacked = () => window.matchMedia(STACKED).matches;
