import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import { tools } from '../tools/tools'
import { finishRouteProgress, startRouteProgress } from '@/utils/routeProgress'

const toolRoutes: RouteRecordRaw[] = tools.map((t) => ({
  path: t.path,
  name: t.name,
  component: t.component
}))

const router = createRouter({
  // 哈希路由：适合 GitHub Pages 子路径部署，形如 https://user.github.io/tool/#/camera-mirror
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView
    },
    ...toolRoutes
  ]
})

router.beforeEach((to, from) => {
  if (to.fullPath !== from.fullPath) {
    startRouteProgress()
  }
})

router.afterEach(() => {
  finishRouteProgress()
})

router.onError(() => {
  finishRouteProgress()
})

export default router
